import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { ClientProviders, OnStatus, RouteString } from './types';

type StatusProps<UserType> = {
	clientProviders: ClientProviders;
	statusRoute?: RouteString;
	onStatus?: OnStatus<UserType>;
};

export const status = <UserType>({
	clientProviders,
	statusRoute = '/oauth2/status',
	onStatus
}: StatusProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.get(
			statusRoute,
			async ({
				error,
				cookie: { user_session_id },
				store: { session }
			}) => {
				if (user_session_id === undefined) {
					return error('Bad Request', 'Cookies are missing');
				}

				// Return null because the user is not logged in, its not an error just a status
				if (user_session_id.value === undefined) {
					onStatus?.({
						user: null
					});

					return new Response(
						JSON.stringify({ isLoggedIn: false, user: null }),
						{
							headers: { 'Content-Type': 'application/json' }
						}
					);
				}

				const userSession = session[user_session_id.value];

				// Return null because the user is not logged in, its not an error just a status
				if (userSession === undefined) {
					onStatus?.({
						user: null
					});

					return new Response(
						JSON.stringify({ isLoggedIn: false, user: null }),
						{
							headers: { 'Content-Type': 'application/json' }
						}
					);
				}

				const { user } = userSession;

				try {
					onStatus?.({
						user
					});
				} catch (err) {
					if (err instanceof Error) {
						return error(
							'Internal Server Error',
							`Error: ${err.message} - ${err.stack ?? ''}`
						);
					}

					return error(
						'Internal Server Error',
						`Unknown Error: ${err}`
					);
				}

				return new Response(
					JSON.stringify({ isLoggedIn: true, user }),
					{
						headers: { 'Content-Type': 'application/json' }
					}
				);
			}
		);
