import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { ClientProviders, OnStatus, RouteString } from './types';

type StatusProps = {
	clientProviders: ClientProviders;
	statusRoute?: RouteString;
	onStatus?: OnStatus;
};

export const status = <UserType>({
	clientProviders,
	statusRoute = '/oauth2/status',
	onStatus
}: StatusProps) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.get(
			statusRoute,
			async ({
				error,
				cookie: { user_session_id, auth_provider },
				store: { session }
			}) => {
				if (
					auth_provider === undefined ||
					user_session_id === undefined
				)
					return error('Bad Request', 'Cookies are missing');

				try {
					// Return null because the user is not logged in, its not an error just a status
					if (auth_provider.value === undefined || user_session_id.value === undefined) {
						onStatus?.({
							authProvider: 'undefined',
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
							authProvider: auth_provider.value,
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

					onStatus?.({
						authProvider: auth_provider.value,
						user
					});

					return new Response(
						JSON.stringify({ isLoggedIn: true, user }),
						{
							headers: { 'Content-Type': 'application/json' }
						}
					);
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
			}
		);
