import { Elysia, t } from 'elysia';
import { loadSessionFromSource } from '../session/access';
import { clearSession } from '../session/promote';
import { sessionStore } from '../session/state';
import { revokeUserSessions } from '../session/userSessions';
import { userSessionIdTypebox } from '../typebox';
import type { CompliancePluginProps } from './config';

const DEFAULT_COMPLIANCE_ROUTE = '/auth/account';

// `GET {complianceRoute}/export` returns the caller's data (right to access). `DELETE
// {complianceRoute}` erases it (right to erasure): it runs the consumer's delete hook, revokes
// every session the user holds, and clears the caller's cookie. Both require an authenticated
// caller and emit an audit event when `auth()` has an audit block.
export const complianceRoutes = <UserType>({
	authSessionStore,
	complianceRoute = DEFAULT_COMPLIANCE_ROUTE,
	deleteUserData,
	emit,
	exportUserData,
	getUserId
}: CompliancePluginProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.get(
			`${complianceRoute}/export`,
			async ({
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				const current = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!current) {
					return status('Unauthorized', 'Authentication required');
				}

				const data = await exportUserData({ user: current.user });
				await emit?.({
					at: Date.now(),
					type: 'data_exported',
					userId: getUserId?.(current.user)
				});

				return status('OK', data);
			},
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) }
		)
		.delete(
			complianceRoute,
			async ({
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				const current = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!current) {
					return status('Unauthorized', 'Authentication required');
				}

				const userId = getUserId?.(current.user);
				await deleteUserData({ user: current.user, userId });
				if (authSessionStore && getUserId && userId !== undefined) {
					await revokeUserSessions({
						authSessionStore,
						getUserId,
						userId
					});
				}
				await clearSession({
					authSessionStore,
					cookie: user_session_id,
					inMemorySession: session
				});
				await emit?.({
					at: Date.now(),
					type: 'account_deleted',
					userId
				});

				return status('OK', { deleted: true });
			},
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) }
		);
