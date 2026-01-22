import { Elysia, t } from 'elysia';
import { sessionStore } from './sessionStore';
import { OnSignOut, RouteString } from './types';

type SignOutProps<UserType> = {
	signoutRoute?: RouteString;
	onSignOut: OnSignOut<UserType>;
};

export const signout = <UserType>({
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

			try {
				await onSignOut?.({
					authProvider: auth_provider.value,
					session,
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

			delete session[user_session_id.value];
			user_session_id.remove();
			auth_provider.remove();

			return new Response(null, { status: 204 });
		},
		{
			cookie: t.Cookie({
				user_session_id: t.Optional(
					t.TemplateLiteral(
						'${string}-${string}-${string}-${string}-${string}'
					)
				)
			})
		}
	);
