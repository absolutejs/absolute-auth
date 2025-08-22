import { Elysia, t } from 'elysia';
import { sessionStore } from './sessionStore';
import { userSessionIdTypebox } from './typebox';
import { StatusReturn } from './types';
import { getStatus } from './utils';

type AuthFailError =
	| Exclude<Awaited<ReturnType<typeof getStatus>>['error'], null>
	| {
			readonly code: 'Unauthorized';
			readonly message: 'User is not authenticated';
	  };

export const protectRoute = <UserType>() =>
	new Elysia()
		.use(sessionStore<UserType>())
		.guard({ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) })
		.derive(
			({ store: { session }, cookie: { user_session_id }, status }) => ({
				protectRoute: async (
					handleAuth: (
						user: UserType
					) => Promise<Response | StatusReturn>,
					handleAuthFail?: (
						error: AuthFailError
					) => Promise<Response | StatusReturn>
				) => {
					const { user, error } = await getStatus<UserType>({
						session,
						user_session_id
					});

					if (error) {
						return (
							handleAuthFail?.(error) ??
							status(error.code, error.message)
						);
					}

					if (!user) {
						return (
							handleAuthFail?.({
								code: 'Unauthorized',
								message: 'User is not authenticated'
							}) ??
							status('Unauthorized', 'User is not authenticated')
						);
					}

					return handleAuth(user);
				}
			})
		)
		.as('global');
