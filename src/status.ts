import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { OnStatus, RouteString } from './types';

type StatusProps<UserType> = {
	statusRoute?: RouteString;
	onStatus?: OnStatus<UserType>;
};

export const status = <UserType>({
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

				const sessionId = user_session_id.value;
				const user =
					sessionId !== undefined && session[sessionId]
						? session[sessionId].user
						: null;

				try {
					await onStatus?.({ user });
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
					JSON.stringify({ isLoggedIn: user !== null, user }),
					{ headers: { 'Content-Type': 'application/json' } }
				);
			}
		);
