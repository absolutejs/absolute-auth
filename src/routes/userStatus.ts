import { Elysia, t } from 'elysia';
import { getStatusFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import { userSessionIdTypebox } from '../typebox';
import { OnStatus, RouteString } from '../types';

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
			const { user, impersonator, error } =
				await getStatusFromSource<UserType>({
					authSessionStore,
					session,
					user_session_id
				});

			if (error) {
				return status(error.code, error.message);
			}

			try {
				await onStatus?.({ impersonator, user });
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

			// `impersonator` is present only for an admin-impersonation session — the client
			// uses it to render an "impersonating <user>" banner and an exit control.
			return { impersonator, user };
		},
		{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) }
	);
