import type { Cookie } from 'elysia';
import { MILLISECONDS_IN_A_DAY } from '../constants';
import type { SessionData, SessionRecord, UserSessionId } from '../types';
import { promoteToSession } from './promote';
import type { AuthSessionStore } from './types';

const DEFAULT_GUEST_TTL_MS = MILLISECONDS_IN_A_DAY;

// Mint a guest/anonymous session (e.g. for a trial or a cart before sign-up). `guestUser` is
// your own throwaway user object (give it a recognizable id like `guest:<uuid>`). The session
// is flagged `anonymous` so `isAnonymousSession` can detect it. To "upgrade": read the guest
// session's user to migrate its data, then run a normal login/register (which rotates the
// cookie to a real session).
export const createAnonymousSession = async <UserType>({
	authSessionStore,
	cookie,
	guestUser,
	inMemorySession,
	sessionDurationMs = DEFAULT_GUEST_TTL_MS
}: {
	authSessionStore?: AuthSessionStore<UserType>;
	cookie: Cookie<UserSessionId | undefined>;
	guestUser: UserType;
	inMemorySession: SessionRecord<UserType>;
	sessionDurationMs?: number;
}) =>
	promoteToSession({
		anonymous: true,
		authSessionStore,
		cookie,
		inMemorySession,
		sessionDurationMs,
		user: guestUser
	});

// Whether a session is a guest/anonymous one.
export const isAnonymousSession = <UserType>(
	session: SessionData<UserType> | undefined
) => session?.anonymous === true;
