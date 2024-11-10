import Elysia from 'elysia';
import { sessionStore } from './sessionStore';

export const protectRoute = <UserType>() => {
	return new Elysia()
		.use(sessionStore<UserType>())
		.derive(
			({ store: { session }, cookie: { user_session_id }, error }) => {
				return {
					protectRoute: async (
						onAuth: () => Promise<Response>,
						onAuthFail?: () => Promise<Response>
					) => {
						if (user_session_id.value === undefined) {
							return (
								onAuthFail?.() ??
								error(401, 'No session ID found')
							);
						}

						const userSession = session[user_session_id.value];

						if (userSession === undefined) {
							return (
								onAuthFail?.() ?? error(401, 'No session found')
							);
						}

						return onAuth();
					}
				};
			}
		)
		.as('plugin');
};
