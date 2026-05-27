import type { Cookie } from 'elysia';
import type { SessionData, SessionRecord, UserSessionId } from '../types';
import { resolveCookieSecure } from '../utils';
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
	anonymous?: boolean;
	authSessionStore?: AuthSessionStore<UserType>;
	cookie: Cookie<UserSessionId | undefined>;
	cookieSecure?: boolean;
	impersonator?: SessionData<UserType>['impersonator'];
	inMemorySession: SessionRecord<UserType>;
	samlLogout?: SessionData<UserType>['samlLogout'];
	sessionDurationMs: number;
	user: UserType;
};

// Creates a registered session for a non-OAuth (credential / MFA-promoted / SSO) user and
// rotates the session cookie. Deliberately omits `accessToken` — these sessions are not
// backed by an OAuth provider token. Shared by credential register/login, the MFA challenge
// route, and the SSO callbacks. `samlLogout` carries the SAML SP-initiated SLO context.
export const promoteToSession = async <UserType>({
	anonymous,
	authSessionStore,
	cookie,
	cookieSecure,
	impersonator,
	inMemorySession,
	samlLogout,
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

	const data: SessionData<UserType> = {
		authenticatedAt: Date.now(),
		expiresAt: Date.now() + sessionDurationMs,
		user
	};
	if (samlLogout !== undefined) data.samlLogout = samlLogout;
	if (impersonator !== undefined) data.impersonator = impersonator;
	if (anonymous === true) data.anonymous = true;
	targetSession[userSessionId] = data;
	cookie.set({
		httpOnly: true,
		sameSite: 'lax',
		secure: resolveCookieSecure(cookieSecure),
		value: userSessionId
	});

	if (authSessionStore) {
		await compatibilityLayer.persist();
	}

	return userSessionId;
};
