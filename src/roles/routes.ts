import { Elysia, t } from 'elysia';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import type { SessionRecord, UserSessionId } from '../types';
import { DEFAULT_ROLES_ROUTE, type RolesRouteProps } from './config';
import { setMemberRoles } from './operations';

// Org-scoped role routes: list an organization's role definitions (org + global) and set a
// member's role slugs. Both gated by the default "active member" check (override via
// `canManageRoles`). `auth()` mounts this when a `roles` block is configured.
export const roleRoutes = <UserType>({
	authSessionStore,
	canManageRoles,
	emit,
	getUserId,
	onRolesAssigned,
	organizationStore,
	roleStore,
	rolesRoute = DEFAULT_ROLES_ROUTE
}: RolesRouteProps<UserType>) => {
	const cookie = t.Cookie({ user_session_id: userSessionIdTypebox });

	const requireUser = async (
		userSessionId: UserSessionId | undefined,
		session: SessionRecord<UserType>
	) => {
		const current = await loadSessionFromSource({
			authSessionStore,
			session,
			userSessionId
		});

		return current?.user;
	};

	const mayManage = async (user: UserType, organizationId: string) => {
		const membership = await organizationStore.getMembership(
			organizationId,
			getUserId(user)
		);
		if (canManageRoles) {
			return canManageRoles({ membership, organizationId, user });
		}

		return membership?.status === 'active';
	};

	return new Elysia()
		.use(sessionStore<UserType>())
		.get(
			`${rolesRoute}/:organizationId`,
			async ({
				cookie: { user_session_id },
				params: { organizationId },
				status,
				store: { session }
			}) => {
				const user = await requireUser(user_session_id.value, session);
				if (!user) {
					return status('Unauthorized', 'Authentication required');
				}
				if (!(await mayManage(user, organizationId))) {
					return status('Forbidden', 'Cannot manage roles');
				}

				const [scoped, global] = await Promise.all([
					roleStore.listRoles(organizationId),
					roleStore.listRoles()
				]);

				return status('OK', { roles: [...scoped, ...global] });
			},
			{ cookie, params: t.Object({ organizationId: t.String() }) }
		)
		.put(
			`${rolesRoute}/:organizationId/members/:userId`,
			async ({
				body: { roles },
				cookie: { user_session_id },
				params: { organizationId, userId },
				status,
				store: { session }
			}) => {
				const user = await requireUser(user_session_id.value, session);
				if (!user) {
					return status('Unauthorized', 'Authentication required');
				}
				if (!(await mayManage(user, organizationId))) {
					return status('Forbidden', 'Cannot manage roles');
				}

				const updated = await setMemberRoles({
					organizationId,
					organizationStore,
					roles,
					userId
				});
				if (!updated) {
					return status('Not Found', 'Membership not found');
				}
				await emit?.({
					at: Date.now(),
					metadata: { roles },
					organizationId,
					type: 'role_assigned',
					userId
				});
				await onRolesAssigned?.({ organizationId, roles, userId });

				return status('OK', { roles: updated.roles });
			},
			{
				body: t.Object({ roles: t.Array(t.String()) }),
				cookie,
				params: t.Object({
					organizationId: t.String(),
					userId: t.String()
				})
			}
		);
};
