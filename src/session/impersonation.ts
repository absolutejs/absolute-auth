import type { Cookie } from 'elysia';
import type { AuditEvent } from '../audit/types';
import { MILLISECONDS_IN_AN_HOUR } from '../constants';
import type {
	Impersonator,
	SessionData,
	SessionRecord,
	UserSessionId
} from '../types';
import { resolveCookieSecure } from '../utils';
import { loadSessionFromSource } from './access';
import { promoteToSession } from './promote';
import type { AuthSessionStore } from './types';

const DEFAULT_IMPERSONATION_TTL_MS = MILLISECONDS_IN_AN_HOUR;

type Emit = (event: AuditEvent) => Promise<void> | void;

// Point the session cookie back at `target` (the admin's own session) if it exists, else
// clear it. Shared by the audit-failure rollback and impersonation exit.
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
		sameSite: 'lax',
		secure: resolveCookieSecure(cookieSecure),
		value: target
	});
};

// Exit impersonation: remove the impersonation session, then restore the admin's original
// session (its `returnToSessionId`) if it's still valid, otherwise clear the cookie. Emits
// an `impersonation_ended` audit event. Returns whether the admin session was restored.
export const endImpersonation = async <UserType>({
	authSessionStore,
	cookie,
	cookieSecure,
	emit,
	inMemorySession
}: {
	authSessionStore?: AuthSessionStore<UserType>;
	cookie: Cookie<UserSessionId | undefined>;
	cookieSecure?: boolean;
	emit?: Emit;
	inMemorySession: SessionRecord<UserType>;
}) => {
	const currentId = cookie.value;
	if (currentId === undefined) return { restored: false };

	const current = await loadSessionFromSource({
		authSessionStore,
		removeExpired: false,
		session: inMemorySession,
		userSessionId: currentId
	});
	const impersonator = current?.impersonator;

	// Only tear down a session that is actually an impersonation session. Calling this on a
	// normal session must NOT silently log the user out — leave it intact and report no-op.
	if (impersonator === undefined) return { restored: false };

	if (authSessionStore) await authSessionStore.removeSession(currentId);
	else delete inMemorySession[currentId];

	await emit?.({
		at: Date.now(),
		metadata:
			impersonator === undefined
				? undefined
				: { actorId: impersonator.actorId },
		type: 'impersonation_ended'
	});

	const returnTo = impersonator?.returnToSessionId;
	const prior =
		returnTo === undefined
			? undefined
			: await loadSessionFromSource({
					authSessionStore,
					session: inMemorySession,
					userSessionId: returnTo
				});
	if (prior !== undefined && returnTo !== undefined) {
		cookie.set({
			httpOnly: true,
			sameSite: 'lax',
			secure: resolveCookieSecure(cookieSecure),
			value: returnTo
		});

		return { restored: true };
	}

	cookie.remove();

	return { restored: false };
};

// Whether a session was created via admin impersonation.
export const isImpersonating = <UserType>(
	session: SessionData<UserType> | undefined
) => session?.impersonator !== undefined;

// Begin impersonating `user` as an admin. Mints a (short-lived, auto-expiring) registered
// session for the target, stamped with the impersonator metadata (RFC 8693 actor
// semantics), captures the caller's current session so `endImpersonation` can restore it,
// rotates the cookie, and emits an `impersonation_started` audit event. Privileged — gate
// it behind your admin auth AND a step-up (`requireRecentAuth`) on your own route; `reason`
// is required and recorded.
//
// Security invariants enforced here (do not rely on the integrator to repeat them):
//   - NESTED IMPERSONATION is refused by default. If the caller's current session is itself
//     an impersonation session, this throws unless `allowNested: true`. RFC 8693 models a
//     delegation chain by NESTING `act` claims, but the flat `impersonator` stamp cannot
//     represent a chain — a second start would silently overwrite the prior actor and let an
//     actor escalate through a target that holds the impersonate grant. Default-off is the
//     safe choice for admin "view as user".
//   - AUDIT ATOMICITY: the `impersonation_started` event is emitted AFTER the session is
//     minted but, if `emit` throws, the freshly minted impersonation session is rolled back
//     and the admin's cookie restored before rethrowing — there is no privileged session
//     that outlives a failed audit write. Provide `emit` (a durable sink) in production.
export const startImpersonation = async <UserType>({
	allowNested = false,
	authSessionStore,
	cookie,
	cookieSecure,
	emit,
	getUserId,
	impersonator,
	inMemorySession,
	sessionDurationMs = DEFAULT_IMPERSONATION_TTL_MS,
	user
}: {
	allowNested?: boolean;
	authSessionStore?: AuthSessionStore<UserType>;
	cookie: Cookie<UserSessionId | undefined>;
	cookieSecure?: boolean;
	emit?: Emit;
	getUserId?: (user: UserType) => string;
	impersonator: { actorEmail?: string; actorId: string; reason: string };
	inMemorySession: SessionRecord<UserType>;
	sessionDurationMs?: number;
	user: UserType;
}) => {
	const callerSessionId = cookie.value;

	// Refuse to start a new impersonation from a session that is already impersonating.
	if (!allowNested && callerSessionId !== undefined) {
		const caller = await loadSessionFromSource({
			authSessionStore,
			removeExpired: false,
			session: inMemorySession,
			userSessionId: callerSessionId
		});
		if (isImpersonating(caller)) {
			throw new Error(
				'startImpersonation: caller session is already impersonating; nested impersonation is disabled (pass allowNested to override)'
			);
		}
	}

	const stamp: Impersonator = {
		actorEmail: impersonator.actorEmail,
		actorId: impersonator.actorId,
		reason: impersonator.reason,
		// promoteToSession keeps the caller's existing session; capture it (before the
		// cookie rotates) so exit can return the admin to it.
		returnToSessionId: callerSessionId,
		startedAt: Date.now()
	};
	const sessionId = await promoteToSession({
		authSessionStore,
		cookie,
		cookieSecure,
		impersonator: stamp,
		inMemorySession,
		sessionDurationMs,
		user
	});

	try {
		await emit?.({
			at: Date.now(),
			metadata: { actorId: stamp.actorId, reason: stamp.reason },
			type: 'impersonation_started',
			userId: getUserId?.(user)
		});
	} catch (auditError) {
		// Audit write failed — undo the privileged session so it cannot outlive its missing
		// audit record, restore the admin's cookie, and surface the failure to the caller.
		if (authSessionStore) await authSessionStore.removeSession(sessionId);
		else delete inMemorySession[sessionId];

		restoreCookieTo(cookie, stamp.returnToSessionId, cookieSecure);

		throw auditError;
	}

	return sessionId;
};
