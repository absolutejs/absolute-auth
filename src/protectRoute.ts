import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { StatusReturn } from './types';

export const protectRoute = <UserType>() =>
	new Elysia()
		.use(sessionStore<UserType>())
		.derive(
			({ store: { session }, cookie: { user_session_id }, status }) => ({
				protectRoute: async (
					handleAuth: () => Promise<Response | StatusReturn>,
					handleAuthFail?: () => Promise<Response | StatusReturn>
				) => {
					if (user_session_id === undefined)
						return status('Bad Request', 'Cookies are missing');

					if (user_session_id.value === undefined) {
						return (
							handleAuthFail?.() ??
							status('Unauthorized', 'No session ID found')
						);
					}

					const userSession = session[user_session_id.value];

					if (userSession === undefined) {
						return (
							handleAuthFail?.() ??
							status('Unauthorized', 'No session found')
						);
					}

					return handleAuth();
				}
			})
		)
		.as('global');
