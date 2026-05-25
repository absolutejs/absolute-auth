import { Elysia, t } from 'elysia';
import { loadSessionFromSource } from '../session/access';
import type { SessionsRouteProps } from '../session/sessionsConfig';
import { sessionStore } from '../session/state';
import { listUserSessions } from '../session/userSessions';
import { isUserSessionId } from '../typeGuards';
import { userSessionIdTypebox } from '../typebox';
import type { UserSessionId } from '../types';

type SessionSummary = {
	authenticatedAt?: number;
	current: boolean;
	expiresAt: number;
	id: UserSessionId;
};

// `GET /auth/sessions` lists the caller's active sessions; `DELETE /auth/sessions/:id`
// revokes one the caller owns. Both require an `authSessionStore` (the source that can
// enumerate sessions).
export const sessionRoutes = <UserType>({
	authSessionStore,
	getUserId,
	sessionsRoute = '/auth/sessions'
}: SessionsRouteProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.get(
			sessionsRoute,
			async ({ cookie: { user_session_id }, status, store: { session } }) => {
				if (!authSessionStore) {
					return status(
						'Not Implemented',
						'Session management requires an authSessionStore'
					);
				}

				const current = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!current) {
					return status('Unauthorized', 'Authentication required');
				}

				const sessions = await listUserSessions({
					authSessionStore,
					getUserId,
					userId: getUserId(current.user)
				});
				const list: SessionSummary[] = sessions.map((entry) => ({
					authenticatedAt: entry.session.authenticatedAt,
					current: entry.id === user_session_id.value,
					expiresAt: entry.session.expiresAt,
					id: entry.id
				}));

				return status('OK', { sessions: list });
			},
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) }
		)
		.delete(
			`${sessionsRoute}/:id`,
			async ({
				cookie: { user_session_id },
				params: { id },
				status,
				store: { session }
			}) => {
				if (!authSessionStore) {
					return status(
						'Not Implemented',
						'Session management requires an authSessionStore'
					);
				}

				const current = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!current) {
					return status('Unauthorized', 'Authentication required');
				}
				if (!isUserSessionId(id)) {
					return status('Bad Request', 'Invalid session id');
				}

				const target = await authSessionStore.getSession(id);
				if (!target || getUserId(target.user) !== getUserId(current.user)) {
					return status('Not Found', 'Session not found');
				}

				await authSessionStore.removeSession(id);

				return status('OK', { revoked: id });
			},
			{
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox }),
				params: t.Object({ id: t.String() })
			}
		);
