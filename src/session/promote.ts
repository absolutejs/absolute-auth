import type { Cookie } from 'elysia';
import type { SessionRecord, UserSessionId } from '../types';
import { createSessionCompatibilityLayer } from './access';
import type { AuthSessionStore } from './types';

type ClearSessionProps<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	cookie: Cookie<UserSessionId | undefined>;
	inMemorySession: SessionRecord<UserType>;
};

// Removes the caller's session everywhere it lives (in-memory state and/or the durable
// session store) and clears the session cookie. Shared by signout-style flows such as SAML
// Single Logout.
export const clearSession = async <UserType>({
	authSessionStore,
	cookie,
	inMemorySession
}: ClearSessionProps<UserType>) => {
	const userSessionId = cookie.value;
	if (userSessionId === undefined) return;

	const compatibilityLayer = await createSessionCompatibilityLayer({
		authSessionStore,
		userSessionId
	});
	const targetSession = authSessionStore
		? compatibilityLayer.session
		: inMemorySession;
	delete targetSession[userSessionId];

	if (authSessionStore) {
		await compatibilityLayer.persist();
		await authSessionStore.removeSession(userSessionId);
		await authSessionStore.removeUnregisteredSession(userSessionId);
	} else {
		delete inMemorySession[userSessionId];
	}

	cookie.remove();
};

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
		authenticatedAt: Date.now(),
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
