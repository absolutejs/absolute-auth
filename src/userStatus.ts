import { Elysia, t } from 'elysia';
import { sessionStore } from './sessionStore';
import { userSessionIdCookie } from './typebox';
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
	new Elysia().use(sessionStore<UserType>()).get(
		statusRoute,
		async ({ status, cookie: { user_session_id }, store: { session } }) => {
			const { user, error } = await getStatus<UserType>({
				onStatus,
				session,
				user_session_id
			});

			if (error) {
				return status(error.code, error.message);
			}

			return user;
		},
		{ cookie: t.Cookie({ user_session_id: userSessionIdCookie }) }
	);
