import { Elysia, StatusMap, t, type ElysiaStatus } from 'elysia';
import { getStatusFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionSource } from '../session/types';
import { userSessionIdTypebox } from '../typebox';
import { pluginDependencySeed } from '../pluginIdentity';
import {
	resolveAccessTokenPrincipal,
	type AccessTokenPrincipalConfig,
	type AuthPrincipal
} from '../principal';

type AuthFailError =
	| {
			readonly code: 'Bad Request';
			readonly message: 'Cookies are missing';
	  }
	| {
			readonly code: 'Unauthorized';
			readonly message: 'User is not authenticated';
	  };

type AuthFailureResponse =
	| ElysiaStatus<
			'Bad Request',
			'Cookies are missing',
			(typeof StatusMap)['Bad Request']
	  >
	| ElysiaStatus<
			'Unauthorized',
			'User is not authenticated',
			(typeof StatusMap)['Unauthorized']
	  >;

type ProtectRoute<UserType> = {
	<AuthReturn, AuthFailReturn = never>(
		handleAuth: (user: UserType) => Promise<AuthReturn>,
		handleAuthFail?: (error: AuthFailError) => AuthFailReturn
	): Promise<AuthFailureResponse | AuthReturn | Awaited<AuthFailReturn>>;
	<AuthReturn, AuthFailReturn = never>(
		handleAuth: (user: UserType) => AuthReturn,
		handleAuthFail?: (error: AuthFailError) => AuthFailReturn
	): Promise<AuthFailureResponse | AuthReturn | Awaited<AuthFailReturn>>;
};

export const protectRoutePlugin = <UserType>({
	accessTokens,
	authSessionStore
}: {
	accessTokens?: AccessTokenPrincipalConfig<UserType>;
	authSessionStore?: AuthSessionSource<UserType>;
} = {}) =>
	new Elysia({
		name: '@absolutejs/auth/protect-route',
		seed: pluginDependencySeed(accessTokens ?? authSessionStore)
	})
		.use(sessionStore<UserType>())
		.guard({
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox }),
			schema: 'merge'
		})
		.derive(
			async ({
				store: { session },
				cookie: { user_session_id },
				headers
			}) => {
				const sessionStatus = await getStatusFromSource<UserType>({
					authSessionStore,
					session,
					user_session_id
				});
				let authPrincipal: AuthPrincipal<UserType> | undefined;
				if (sessionStatus.user)
					authPrincipal = {
						kind: 'session',
						subject:
							accessTokens?.oidc.getUserId(sessionStatus.user) ??
							'',
						user: sessionStatus.user
					};
				else if (accessTokens)
					authPrincipal = await resolveAccessTokenPrincipal({
						authorization: headers.authorization,
						config: accessTokens
					});

				return { absoluteAuthStatus: sessionStatus, authPrincipal };
			}
		)
		.derive(({ absoluteAuthStatus, authPrincipal, status }) => {
			const protectRoute: ProtectRoute<UserType> = async (
				handleAuth,
				handleAuthFail
			) => {
				if (!absoluteAuthStatus)
					return (
						(await handleAuthFail?.({
							code: 'Unauthorized',
							message: 'User is not authenticated'
						})) ??
						status('Unauthorized', 'User is not authenticated')
					);

				const user = authPrincipal?.user;
				const { error } = absoluteAuthStatus;
				if (error) {
					if (user) return handleAuth(user);

					return (
						(await handleAuthFail?.(error)) ??
						status(error.code, error.message)
					);
				}

				if (!user) {
					return (
						(await handleAuthFail?.({
							code: 'Unauthorized',
							message: 'User is not authenticated'
						})) ??
						status('Unauthorized', 'User is not authenticated')
					);
				}

				return handleAuth(user);
			};

			return { protectRoute };
		})
		.as('global');
