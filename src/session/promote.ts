import type { Cookie } from 'elysia';
import type { SessionRecord, UserSessionId } from '../types';
import { createSessionCompatibilityLayer } from './access';
import type { AuthSessionStore } from './types';

export const persistWhen = async (
	shouldPersist: boolean,
	persist: () => Promise<void>
) => {
	if (shouldPersist) await persist();
};

type PromoteToSessionProps<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	cookie: Cookie<UserSessionId | undefined>;
	inMemorySession: SessionRecord<UserType>;
	sessionDurationMs: number;
	user: UserType;
};

// Creates a registered session for a non-OAuth (credential / MFA-promoted) user and
// rotates the session cookie. Deliberately omits `accessToken` — these sessions are not
// backed by an OAuth provider token. Shared by credential register/login and the MFA
// challenge route.
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
