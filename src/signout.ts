import { Elysia, t } from 'elysia';
import { sessionStore } from './sessionStore';
import { OnSignOut, RouteString } from './types';

type SignOutProps<UserType> = {
	signoutRoute?: RouteString;
	onSignOut?: OnSignOut<UserType>;
};

export const signout = <UserType>({
	signoutRoute = '/oauth2/signout',
	onSignOut
}: SignOutProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).delete(
		signoutRoute,
		async ({
			error,
			store: { session },
			cookie: { user_session_id, auth_provider }
		}) => {
			if (auth_provider === undefined || user_session_id === undefined) {
				return error('Bad Request', 'Cookies are missing');
			}

			if (auth_provider.value === undefined) {
				return error('Unauthorized', 'No auth provider found');
			}
			if (user_session_id.value === undefined) {
				return error('Unauthorized', 'No user session id found');
			}

			try {
				onSignOut?.({
					authProvider: auth_provider.value,
					session,
					userSessionId: user_session_id.value
				});
			} catch (err) {
				if (err instanceof Error) {
					return error(
						'Internal Server Error',
						`Error: ${err.message} - ${err.stack ?? ''}`
					);
				}

				return error('Internal Server Error', `Unknown Error: ${err}`);
			}

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
