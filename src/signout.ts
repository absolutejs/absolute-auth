import { Elysia } from 'elysia';
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
	new Elysia()
		.use(sessionStore<UserType>())
		.delete(
			signoutRoute,
			async ({
				error,
				store: { session },
				cookie: { user_session_id, auth_provider }
			}) => {
				if (
					auth_provider === undefined ||
					user_session_id === undefined
				) {
					return error('Bad Request', 'Cookies are missing');
				}

				if (auth_provider.value === undefined) {
					return error('Unauthorized', 'No auth provider found');
				}
				if (user_session_id.value === undefined) {
					return error('Unauthorized', 'No user session found');
				}

				const userSession = session[user_session_id.value];

				if (userSession === undefined) {
					return error('Unauthorized', 'User session not found');
				}

				user_session_id.remove();
				auth_provider.remove();

				try {
					onSignOut?.({
						authProvider: auth_provider.value,
						userSession
					});

					return new Response(null, { status: 204 });
				} catch (err) {
					const msg =
						err instanceof Error
							? `Failed to sign out: ${err.message}`
							: `Failed to sign out: ${err}`;

					return error('Internal Server Error', msg);
				}
			}
		);
