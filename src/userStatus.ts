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
				const { data, error } = await getStatus<UserType>({
					onStatus,
					session,
					user_session_id
				});

				if (error) {
					return status(error.code, error.message);
				}

				return { isLoggedIn: data.isLoggedIn, user: data.user };
			}
		);
