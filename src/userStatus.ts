import { Elysia, t } from 'elysia';
import { getStatusFromSource } from './sessionAccess';
import { sessionStore } from './sessionStore';
import type { AuthSessionStore } from './sessionTypes';
import { userSessionIdTypebox } from './typebox';
import { OnStatus, RouteString } from './types';

type StatusProps<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	statusRoute?: RouteString;
	onStatus: OnStatus<UserType>;
};

export const userStatus = <UserType>({
	authSessionStore,
	statusRoute = '/oauth2/status',
	onStatus
}: StatusProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).get(
		statusRoute,
		async ({ status, cookie: { user_session_id }, store: { session } }) => {
			const { user, error } = await getStatusFromSource<UserType>({
				authSessionStore,
				session,
				user_session_id
			});

			if (error) {
				return status(error.code, error.message);
			}

			try {
				await onStatus?.({ user });
			} catch (err) {
				return err instanceof Error
					? status(
							'Internal Server Error',
							`Error: ${err.message} - ${err.stack ?? ''}`
						)
					: status(
							'Internal Server Error',
							`Unknown Error: ${String(err)}`
						);
			}

			return { user };
		},
		{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) }
	);
