import { Elysia, t } from 'elysia';
import { createSessionCompatibilityLayer } from './sessionAccess';
import { sessionStore } from './sessionStore';
import type { AuthSessionStore } from './sessionTypes';
import { authProviderOption } from './typebox';
import { OnSignOut, RouteString } from './types';

type SignOutProps<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	signoutRoute?: RouteString;
	onSignOut: OnSignOut<UserType>;
};

export const signout = <UserType>({
	authSessionStore,
	signoutRoute = '/oauth2/signout',
	onSignOut
}: SignOutProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).delete(
		signoutRoute,
		async ({
			status,
			store: { session },
			cookie: { user_session_id, auth_provider }
		}) => {
			if (auth_provider === undefined || user_session_id === undefined) {
				return status('Bad Request', 'Cookies are missing');
			}

			if (auth_provider.value === undefined) {
				return status('Unauthorized', 'No auth provider found');
			}
			if (user_session_id.value === undefined) {
				return status('Unauthorized', 'No user session id found');
			}

			const compatibilityLayer = await createSessionCompatibilityLayer({
				authSessionStore,
				userSessionId: user_session_id.value
			});
			const signoutSession = authSessionStore
				? compatibilityLayer.session
				: session;
			const currentSession = signoutSession[user_session_id.value];

			if (currentSession !== undefined) {
				try {
					await onSignOut?.({
						authProvider: auth_provider.value,
						session: signoutSession,
						userSessionId: user_session_id.value
					});
				} catch (err) {
					console.error('[signout] Sign out operation failed:', {
						authProvider: auth_provider.value,
						error: err instanceof Error ? err.message : err,
						stack: err instanceof Error ? err.stack : undefined
					});

					return status(
						'Internal Server Error',
						'Sign out operation failed'
					);
				}
			}

			delete signoutSession[user_session_id.value];
			if (authSessionStore) {
				await compatibilityLayer.persist();
				await authSessionStore.removeSession(user_session_id.value);
				await authSessionStore.removeUnregisteredSession(
					user_session_id.value
				);
			} else {
				delete session[user_session_id.value];
			}

			user_session_id.remove();
			auth_provider.remove();

			return new Response(null, { status: 204 });
		},
		{
			cookie: t.Cookie({
				auth_provider: t.Optional(authProviderOption),
				user_session_id: t.Optional(
					t.TemplateLiteral(
						'${string}-${string}-${string}-${string}-${string}'
					)
				)
			})
		}
	);
