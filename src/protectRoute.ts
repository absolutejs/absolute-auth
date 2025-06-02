import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';

export const protectRoute = <UserType>() =>
	new Elysia()
		.use(sessionStore<UserType>())
		.derive(
			({ store: { session }, cookie: { user_session_id }, error }) => ({
				protectRoute: async (
					handleAuth: () => Promise<Response>,
					handleAuthFail?: () => Promise<Response>
				) => {
					if (user_session_id === undefined)
						return error('Bad Request', 'Cookies are missing');

					if (user_session_id.value === undefined) {
						return (
							handleAuthFail?.() ??
							error('Unauthorized', 'No session ID found')
						);
					}

					const userSession = session[user_session_id.value];

					if (userSession === undefined) {
						return (
							handleAuthFail?.() ??
							error('Unauthorized', 'No session found')
						);
					}

					return handleAuth();
				}
			})
		)
		.as('global');
