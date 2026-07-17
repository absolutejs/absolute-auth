import { Elysia, t } from 'elysia';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionSource } from '../session/types';
import { userSessionIdTypebox } from '../typebox';
import { pluginDependencySeed } from '../pluginIdentity';

type ReauthFailError = {
	readonly code: 'Unauthorized';
	readonly message: 'Recent authentication required';
};

// Step-up re-auth, usable alongside `protectRoute`. `requireRecentAuth(maxAgeMs, …)`
// runs the handler only when the session was authenticated within the window — a token
// refresh does NOT count, so sensitive actions can demand a fresh login / MFA.
export const stepUpPlugin = <UserType>({
	authSessionStore
}: {
	authSessionStore?: AuthSessionSource<UserType>;
} = {}) =>
	new Elysia({
		name: '@absolutejs/auth/step-up',
		seed: pluginDependencySeed(authSessionStore)
	})
		.use(sessionStore<UserType>())
		.guard({ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) })
		.derive(
			({ store: { session }, cookie: { user_session_id }, status }) => ({
				requireRecentAuth: <AuthReturn, AuthFailReturn>(
					maxAgeMs: number,
					handleAuth: (
						user: UserType
					) => AuthReturn | Promise<AuthReturn>,
					handleAuthFail?: (error: ReauthFailError) => AuthFailReturn
				) =>
					loadSessionFromSource<UserType>({
						authSessionStore,
						session,
						userSessionId: user_session_id.value
					}).then((userSession) => {
						const authenticatedAt = userSession?.authenticatedAt;
						const isRecent =
							authenticatedAt !== undefined &&
							Date.now() - authenticatedAt <= maxAgeMs;

						if (!userSession || !isRecent) {
							return (
								handleAuthFail?.({
									code: 'Unauthorized',
									message: 'Recent authentication required'
								}) ??
								status(
									'Unauthorized',
									'Recent authentication required'
								)
							);
						}

						return handleAuth(userSession.user);
					})
			})
		)
		.as('global');
