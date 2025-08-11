import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { OnStatus, RouteString } from './types';
import { getStatus } from './utils';

type StatusProps<UserType> = {
	statusRoute?: RouteString;
	onStatus: OnStatus<UserType>;
};

export const userStatus = <UserType>({
	statusRoute = '/oauth2/status',
	onStatus
}: StatusProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.get(
			statusRoute,
			async ({
				status,
				cookie: { user_session_id },
				store: { session }
			}) => {
				const response = await getStatus<UserType>({
					onStatus,
					session,
					user_session_id
				});

				if (response.type === 'error') {
					return status(response.error.code, response.error.message);
				}

				return { isLoggedIn: response.isLoggedIn, user: response.user };
			}
		);
