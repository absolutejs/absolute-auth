import type { Cookie } from 'elysia';
import type { AuditEvent } from '../audit/types';
import { MILLISECONDS_IN_AN_HOUR } from '../constants';
import type {
	Impersonator,
	SessionData,
	SessionRecord,
	UserSessionId
} from '../types';
import { loadSessionFromSource } from './access';
import { promoteToSession } from './promote';
import type { AuthSessionStore } from './types';

const DEFAULT_IMPERSONATION_TTL_MS = MILLISECONDS_IN_AN_HOUR;

type Emit = (event: AuditEvent) => Promise<void> | void;

// Exit impersonation: remove the impersonation session, then restore the admin's original
// session (its `returnToSessionId`) if it's still valid, otherwise clear the cookie. Emits
// an `impersonation_ended` audit event. Returns whether the admin session was restored.
export const endImpersonation = async <UserType>({
	authSessionStore,
	cookie,
	emit,
	inMemorySession
}: {
	authSessionStore?: AuthSessionStore<UserType>;
	cookie: Cookie<UserSessionId | undefined>;
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
			secure: true,
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
export const startImpersonation = async <UserType>({
	authSessionStore,
	cookie,
	emit,
	getUserId,
	impersonator,
	inMemorySession,
	sessionDurationMs = DEFAULT_IMPERSONATION_TTL_MS,
	user
}: {
	authSessionStore?: AuthSessionStore<UserType>;
	cookie: Cookie<UserSessionId | undefined>;
	emit?: Emit;
	getUserId?: (user: UserType) => string;
	impersonator: { actorEmail?: string; actorId: string; reason: string };
	inMemorySession: SessionRecord<UserType>;
	sessionDurationMs?: number;
	user: UserType;
}) => {
	const stamp: Impersonator = {
		actorEmail: impersonator.actorEmail,
		actorId: impersonator.actorId,
		reason: impersonator.reason,
		// promoteToSession keeps the caller's existing session; capture it (before the
		// cookie rotates) so exit can return the admin to it.
		returnToSessionId: cookie.value,
		startedAt: Date.now()
	};
	const sessionId = await promoteToSession({
		authSessionStore,
		cookie,
		impersonator: stamp,
		inMemorySession,
		sessionDurationMs,
		user
	});
	await emit?.({
		at: Date.now(),
		metadata: { actorId: stamp.actorId, reason: stamp.reason },
		type: 'impersonation_started',
		userId: getUserId?.(user)
	});

	return sessionId;
};
