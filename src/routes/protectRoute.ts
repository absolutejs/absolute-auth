import { Elysia, t } from 'elysia';
import { getStatusFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionSource } from '../session/types';
import { userSessionIdTypebox } from '../typebox';
import { pluginDependencySeed } from '../pluginIdentity';

type AuthFailError =
	| {
			readonly code: 'Bad Request';
			readonly message: 'Cookies are missing';
	  }
	| {
			readonly code: 'Unauthorized';
			readonly message: 'User is not authenticated';
	  };

export const protectRoutePlugin = <UserType>({
	authSessionStore
}: {
	authSessionStore?: AuthSessionSource<UserType>;
} = {}) =>
	new Elysia({
		name: '@absolutejs/auth/protect-route',
		seed: pluginDependencySeed(authSessionStore)
	})
		.use(sessionStore<UserType>())
		.guard({ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) })
		.derive(
			({ store: { session }, cookie: { user_session_id }, status }) => ({
				protectRoute: <AuthReturn, AuthFailReturn = never>(
					handleAuth: (
						user: UserType
					) => AuthReturn | Promise<AuthReturn>,
					handleAuthFail?: (error: AuthFailError) => AuthFailReturn
				) =>
					getStatusFromSource<UserType>({
						authSessionStore,
						session,
						user_session_id
					}).then(async ({ user, error }) => {
						if (error) {
							return (
								handleAuthFail?.(error) ??
								status(error.code, error.message)
							);
						}

						if (!user) {
							return (
								handleAuthFail?.({
									code: 'Unauthorized',
									message: 'User is not authenticated'
								}) ??
								status(
									'Unauthorized',
									'User is not authenticated'
								)
							);
						}

						return handleAuth(user);
					})
			})
		)
		.as('global');
