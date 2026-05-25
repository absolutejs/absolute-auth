import type { Cookie } from 'elysia';
import { isUserSessionId } from '../typeGuards';
import type { SessionRecord, UserSessionId } from '../types';
import { loadSessionFromSource } from './access';
import type { AuthSessionStore } from './types';

// Multi-session ("switch account"): keep several logged-in sessions in one browser. The
// active session stays in the normal `user_session_id` cookie; this tracks the full set in a
// second `ring` cookie (space-separated session ids). Call `addToSessionRing` after each
// login, `listRingSessions` to render an account switcher, `switchActiveSession` to change the
// active account, and `removeFromSessionRing` to sign one out.

const SEPARATOR = ' ';

const writeRing = (ring: Cookie<string | undefined>, ids: UserSessionId[]) =>
	ring.set({
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		value: ids.join(SEPARATOR)
	});

const readRing = (ring: Cookie<string | undefined>) =>
	(ring.value ?? '')
		.split(SEPARATOR)
		.filter((entry): entry is UserSessionId => isUserSessionId(entry));

export const addToSessionRing = (
	ring: Cookie<string | undefined>,
	sessionId: UserSessionId
) => writeRing(ring, [...new Set([...readRing(ring), sessionId])]);

// Resolve the ring to its still-valid sessions (for an account switcher). Drops expired ones.
export const listRingSessions = async <UserType>({
	authSessionStore,
	inMemorySession,
	ring
}: {
	authSessionStore?: AuthSessionStore<UserType>;
	inMemorySession?: SessionRecord<UserType>;
	ring: Cookie<string | undefined>;
}) => {
	const resolved = await Promise.all(
		readRing(ring).map(async (sessionId) => {
			const session = await loadSessionFromSource({
				authSessionStore,
				session: inMemorySession,
				userSessionId: sessionId
			});

			return session === undefined
				? undefined
				: { sessionId, user: session.user };
		})
	);

	return resolved.filter(
		(entry): entry is { sessionId: UserSessionId; user: UserType } =>
			entry !== undefined
	);
};

// The session ids in the ring (the active one is in `user_session_id`).
export const readSessionRing = (ring: Cookie<string | undefined>) =>
	readRing(ring);

// Sign one account out: remove it from the ring + the store, and if it was active, fall back
// to another ring member (or clear the active cookie).
export const removeFromSessionRing = async <UserType>({
	activeCookie,
	authSessionStore,
	inMemorySession,
	ring,
	sessionId
}: {
	activeCookie?: Cookie<UserSessionId | undefined>;
	authSessionStore?: AuthSessionStore<UserType>;
	inMemorySession?: SessionRecord<UserType>;
	ring: Cookie<string | undefined>;
	sessionId: UserSessionId;
}) => {
	const remaining = readRing(ring).filter((id) => id !== sessionId);
	writeRing(ring, remaining);
	if (authSessionStore) await authSessionStore.removeSession(sessionId);
	else if (inMemorySession) delete inMemorySession[sessionId];

	if (activeCookie?.value !== sessionId) return;
	const [fallback] = remaining;
	if (fallback === undefined) activeCookie.remove();
	else
		activeCookie.set({
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			value: fallback
		});
};

// Make a ring member the active session. Returns false if it isn't in the ring.
export const switchActiveSession = ({
	activeCookie,
	ring,
	sessionId
}: {
	activeCookie: Cookie<UserSessionId | undefined>;
	ring: Cookie<string | undefined>;
	sessionId: UserSessionId;
}) => {
	if (!readRing(ring).includes(sessionId)) return false;
	activeCookie.set({
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		value: sessionId
	});

	return true;
};
