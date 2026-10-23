import type { Cookie } from 'elysia';
import type { AuditEvent } from '../audit/types';
import {
	MILLISECONDS_IN_AN_HOUR,
	MILLISECONDS_IN_A_MINUTE
} from '../constants';
import { hasRecentAuthentication } from '../mfa/recentAuth';
import type { Impersonator, SessionData, SessionRecord, UserSessionId } from '../types';
import { resolveCookieSecure } from '../utils';
import { loadSessionFromSource } from './access';
import { promoteToSession } from './promote';
import type { AuthSessionStore } from './types';

export const MAX_IMPERSONATION_REASON_LENGTH = 500;
export const MIN_IMPERSONATION_REASON_LENGTH = 10;
const DEFAULT_AUTH_MAX_AGE_MS = 5 * MILLISECONDS_IN_A_MINUTE;
export type ImpersonationMode = 'ghost' | 'sandbox' | 'live';
const MODE_FLAGS = {
	ghost: { readOnly: true, suppressSideEffects: false },
	live: { readOnly: false, suppressSideEffects: false },
	sandbox: { readOnly: false, suppressSideEffects: true }
} as const;
type Emit = (event: AuditEvent) => Promise<void> | void;
type SessionOptions<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	cookie: Cookie<UserSessionId | undefined>;
	cookieSecure?: boolean;
	emit: Emit;
	inMemorySession: SessionRecord<UserType>;
};
type AuthorizationOptions<UserType> = {
	/** Read current application permissions/MFA policy, not a stale session role. */
	authorize: (
		actor: UserType,
		target: UserType
	) => boolean | Promise<boolean>;
	getUserId: (user: UserType) => string;
	getActorEmail?: (user: UserType) => string | undefined;
	maxAuthAgeMs?: number;
};
export class ImpersonationError extends Error {
	constructor(
		readonly code: string,
		readonly status: 400 | 401 | 403 | 409 | 500,
		message: string
	) {
		super(message);
		this.name = 'ImpersonationError';
	}
}
const requireAudit = (emit: Emit) => {
	if (typeof emit !== 'function')
		throw new ImpersonationError(
			'impersonation_configuration',
			500,
			'Impersonation requires a durable audit sink.'
		);
};
const requireRecent = <UserType>(
	session: SessionData<UserType>,
	maxAgeMs: number
) => {
	if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0)
		throw new ImpersonationError(
			'impersonation_configuration',
			500,
			'Invalid impersonation authentication policy.'
		);
	if (!hasRecentAuthentication(session, maxAgeMs))
		throw new ImpersonationError(
			'reauthentication_required',
			401,
			'Recent authentication required'
		);
};
const restoreCookieTo = (
	cookie: Cookie<UserSessionId | undefined>,
	target: UserSessionId | undefined,
	cookieSecure?: boolean
) => {
	if (target === undefined) {
		cookie.remove();

		return;
	}
	cookie.set({
		httpOnly: true,
		path: '/',
		sameSite: 'lax',
		secure: resolveCookieSecure(cookieSecure),
		value: target
	});
};
/** Recheck the original actor's current authority before changing the member-session mode. */
export const changeImpersonationMode = async <UserType>({
	authSessionStore,
	authorize,
	cookie,
	emit,
	getUserId,
	inMemorySession,
	maxAuthAgeMs = DEFAULT_AUTH_MAX_AGE_MS,
	mode
}: SessionOptions<UserType> &
	AuthorizationOptions<UserType> & { mode: ImpersonationMode }) => {
	requireAudit(emit);
	const currentId = cookie.value;
	const current = await loadSessionFromSource({
		authSessionStore,
		session: inMemorySession,
		userSessionId: currentId
	});
	if (!currentId || !current?.impersonator)
		throw new ImpersonationError(
			'impersonation_required',
			400,
			'Not currently impersonating.'
		);
	const actor = await loadSessionFromSource({
		authSessionStore,
		session: inMemorySession,
		userSessionId: current.impersonator.returnToSessionId
	});
	if (
		!actor ||
		actor.anonymous ||
		actor.impersonator ||
		getUserId(actor.user) !== current.impersonator.actorId
	)
		throw new ImpersonationError(
			'authentication_required',
			401,
			'Exit the member view and sign in again.'
		);
	if (!Object.hasOwn(MODE_FLAGS, mode))
		throw new ImpersonationError(
			'impersonation_mode_invalid',
			400,
			'Choose a valid member-view mode.'
		);
	if (mode !== 'ghost') requireRecent(actor, maxAuthAgeMs);
	if (
		typeof authorize !== 'function' ||
		!(await authorize(actor.user, current.user))
	)
		throw new ImpersonationError(
			'impersonation_forbidden',
			403,
			'Your permission to view this member account is no longer available.'
		);
	const updated: SessionData<UserType> = {
		...current,
		impersonator: { ...current.impersonator, ...MODE_FLAGS[mode] }
	};
	if (authSessionStore) await authSessionStore.setSession(currentId, updated);
	else inMemorySession[currentId] = updated;
	try {
		await emit({
			at: Date.now(),
			metadata: {
				actorEmail: current.impersonator.actorEmail,
				actorId: current.impersonator.actorId,
				mode,
				reason: current.impersonator.reason
			},
			type: 'impersonation_mode_changed',
			userId: getUserId(current.user)
		});
	} catch (error) {
		if (authSessionStore)
			await authSessionStore.setSession(currentId, current);
		else inMemorySession[currentId] = current;
		throw error;
	}

	return { mode, ...MODE_FLAGS[mode] };
};
/** End remains available without fresh authentication; a failed audit must not strand an invalid cookie. */
export const endImpersonation = async <UserType>({
	authSessionStore,
	cookie,
	cookieSecure,
	emit,
	getUserId,
	inMemorySession
}: SessionOptions<UserType> & { getUserId: (user: UserType) => string }) => {
	requireAudit(emit);
	const currentId = cookie.value;
	if (currentId === undefined) return { restored: false };
	const current = await loadSessionFromSource({
		authSessionStore,
		removeExpired: false,
		session: inMemorySession,
		userSessionId: currentId
	});
	const actor = current?.impersonator;
	if (!actor) return { restored: false };
	await emit({
		at: Date.now(),
		metadata: {
			actorEmail: actor.actorEmail,
			actorId: actor.actorId,
			reason: actor.reason
		},
		type: 'impersonation_ended',
		userId: getUserId(current.user)
	});
	if (authSessionStore) await authSessionStore.removeSession(currentId);
	else delete inMemorySession[currentId];
	const prior = await loadSessionFromSource({
		authSessionStore,
		session: inMemorySession,
		userSessionId: actor.returnToSessionId
	});
	restoreCookieTo(
		cookie,
		prior ? actor.returnToSessionId : undefined,
		cookieSecure
	);

	return { restored: Boolean(prior) };
};
export const isImpersonating = <UserType>(
	session: SessionData<UserType> | undefined
) => session?.impersonator !== undefined;
/** Canonical privileged transition: caller identity, freshness, policy, reason and audit are mandatory. */
export const startImpersonation = async <UserType>({
	authSessionStore,
	authorize,
	cookie,
	cookieSecure,
	emit,
	getActorEmail,
	getUserId,
	inMemorySession,
	maxAuthAgeMs = DEFAULT_AUTH_MAX_AGE_MS,
	mode = 'ghost',
	reason,
	sessionDurationMs = MILLISECONDS_IN_AN_HOUR,
	user
}: SessionOptions<UserType> &
	AuthorizationOptions<UserType> & {
		mode?: ImpersonationMode;
		reason: string;
		sessionDurationMs?: number;
		user: UserType;
	}) => {
	requireAudit(emit);
	const callerSessionId = cookie.value;
	const caller = await loadSessionFromSource({
		authSessionStore,
		session: inMemorySession,
		userSessionId: callerSessionId
	});
	if (!caller || caller.anonymous)
		throw new ImpersonationError(
			'authentication_required',
			401,
			'Sign in before viewing a member account.'
		);
	if (isImpersonating(caller))
		throw new ImpersonationError(
			'impersonation_nested',
			409,
			'End the current impersonation before starting another.'
		);
	requireRecent(caller, maxAuthAgeMs);
	const actorId = getUserId(caller.user);
	const targetId = getUserId(user);
	if (!actorId || !targetId || actorId === targetId)
		throw new ImpersonationError(
			'impersonation_target_invalid',
			400,
			'Choose a different member account.'
		);
	const normalizedReason = reason.trim();
	if (
		normalizedReason.length < MIN_IMPERSONATION_REASON_LENGTH ||
		normalizedReason.length > MAX_IMPERSONATION_REASON_LENGTH
	)
		throw new ImpersonationError(
			'impersonation_reason_invalid',
			400,
			`Document a specific reason (${MIN_IMPERSONATION_REASON_LENGTH}–${MAX_IMPERSONATION_REASON_LENGTH} characters).`
		);
	if (
		!Object.hasOwn(MODE_FLAGS, mode) ||
		!Number.isFinite(sessionDurationMs) ||
		sessionDurationMs <= 0 ||
		sessionDurationMs > MILLISECONDS_IN_AN_HOUR
	)
		throw new ImpersonationError(
			'impersonation_configuration',
			400,
			'Invalid impersonation mode or duration.'
		);
	if (
		typeof authorize !== 'function' ||
		!(await authorize(caller.user, user))
	)
		throw new ImpersonationError(
			'impersonation_forbidden',
			403,
			'You do not have permission to view this member account.'
		);
	if (caller.expiresAt <= Date.now())
		throw new ImpersonationError(
			'authentication_required',
			401,
			'Sign in before viewing a member account.'
		);
	requireRecent(caller, maxAuthAgeMs);
	const stamp: Impersonator = {
		actorEmail: getActorEmail?.(caller.user),
		actorId,
		reason: normalizedReason,
		returnToSessionId: callerSessionId,
		startedAt: Date.now(),
		...MODE_FLAGS[mode]
	};
	const sessionId = await promoteToSession({
		authSessionStore,
		cookie,
		cookieSecure,
		impersonator: stamp,
		inMemorySession,
		sessionDurationMs: Math.min(
			sessionDurationMs,
			caller.expiresAt - Date.now()
		),
		user
	});
	try {
		await emit({
			at: Date.now(),
			metadata: {
				actorEmail: stamp.actorEmail,
				actorId,
				mode,
				reason: normalizedReason
			},
			type: 'impersonation_started',
			userId: targetId
		});
	} catch (error) {
		if (authSessionStore) await authSessionStore.removeSession(sessionId);
		else delete inMemorySession[sessionId];
		restoreCookieTo(cookie, callerSessionId, cookieSecure);
		throw error;
	}

	return sessionId;
};
