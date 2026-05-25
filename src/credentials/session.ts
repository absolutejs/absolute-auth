import type { Cookie } from 'elysia';
import { createSessionCompatibilityLayer } from '../session/access';
import type { AuthSessionStore } from '../session/types';
import type { SessionRecord, UserSessionId } from '../types';

type PromoteToSessionProps<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	cookie: Cookie<UserSessionId | undefined>;
	inMemorySession: SessionRecord<UserType>;
	sessionDurationMs: number;
	user: UserType;
};

// Creates a registered session for a credential-authenticated user and rotates the
// session cookie. Deliberately omits `accessToken` — credential sessions are not backed
// by an OAuth provider token. Shared by register (auto-login) and login.
export const promoteToSession = async <UserType>({
	authSessionStore,
	cookie,
	inMemorySession,
	sessionDurationMs,
	user
}: PromoteToSessionProps<UserType>) => {
	const compatibilityLayer = await createSessionCompatibilityLayer({
		authSessionStore,
		userSessionId: cookie.value
	});
	const targetSession = authSessionStore
		? compatibilityLayer.session
		: inMemorySession;
	const userSessionId = crypto.randomUUID();

	targetSession[userSessionId] = {
		expiresAt: Date.now() + sessionDurationMs,
		user
	};
	cookie.set({
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		value: userSessionId
	});

	if (authSessionStore) {
		await compatibilityLayer.persist();
	}

	return userSessionId;
};
