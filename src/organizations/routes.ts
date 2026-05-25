import { Elysia, t } from 'elysia';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import type { SessionRecord, UserSessionId } from '../types';
import {
	DEFAULT_ORGANIZATIONS_ROUTE,
	type OrganizationsRouteProps
} from './config';
import {
	acceptInvitation,
	createOrganization,
	inviteToOrganization,
	listUserOrganizations
} from './operations';

// Tenant routes: list the caller's orgs, create one (caller becomes owner), invite / list / revoke
// invitations, accept an invite, and list / remove members. Member-management routes are gated by
// the default "active member" check (override with `canManageMembers`). `auth()` mounts this before
// `protectRoutePlugin` when an `organizations` block is configured.
export const organizationRoutes = <UserType>({
	authSessionStore,
	canCreateOrganization,
	canManageMembers,
	emit,
	getUserId,
	invitationDurationMs,
	onMembershipAdded,
	onMembershipRemoved,
	onOrganizationCreated,
	onSendInvitation,
	organizationsRoute = DEFAULT_ORGANIZATIONS_ROUTE,
	organizationStore,
	ownerRoles
}: OrganizationsRouteProps<UserType>) => {
	const cookie = t.Cookie({ user_session_id: userSessionIdTypebox });

	// Resolve the authenticated caller (or undefined → the routes return 401).
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

	// The default management gate: an active member may manage, unless `canManageMembers` overrides.
	const mayManage = async (user: UserType, organizationId: string) => {
		const membership = await organizationStore.getMembership(
			organizationId,
			getUserId(user)
		);
		if (canManageMembers) {
			return canManageMembers({ membership, organizationId, user });
		}

		return membership?.status === 'active';
	};

	return new Elysia()
		.use(sessionStore<UserType>())
		.get(
			organizationsRoute,
			async ({
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				const user = await requireUser(user_session_id.value, session);
				if (!user) {
					return status('Unauthorized', 'Authentication required');
				}

				const organizations = await listUserOrganizations({
					organizationStore,
					userId: getUserId(user)
				});

				return status('OK', { organizations });
			},
			{ cookie }
		)
		.post(
			organizationsRoute,
			async ({
				body: { metadata, name },
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				const user = await requireUser(user_session_id.value, session);
				if (!user) {
					return status('Unauthorized', 'Authentication required');
				}
				if (
					canCreateOrganization &&
					!(await canCreateOrganization(user))
				) {
					return status('Forbidden', 'Cannot create organizations');
				}

				const ownerUserId = getUserId(user);
				const organization = await createOrganization({
					metadata,
					name,
					organizationStore,
					ownerRoles,
					ownerUserId
				});
				await emit?.({
					at: Date.now(),
					organizationId: organization.organizationId,
					type: 'organization_created',
					userId: ownerUserId
				});
				await onOrganizationCreated?.({
					organizationId: organization.organizationId,
					ownerUserId
				});

				return status('OK', { organization });
			},
			{
				body: t.Object({
					metadata: t.Optional(t.Record(t.String(), t.Unknown())),
					name: t.String()
				}),
				cookie
			}
		)
		.post(
			`${organizationsRoute}/:organizationId/invitations`,
			async ({
				body: { email, roles },
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
					return status('Forbidden', 'Cannot manage members');
				}

				const { invitation, token } = await inviteToOrganization({
					email,
					invitationDurationMs,
					inviterUserId: getUserId(user),
					organizationId,
					organizationStore,
					roles: roles ?? []
				});
				await onSendInvitation?.({
					email: invitation.email,
					expiresAt: invitation.expiresAt,
					inviterUserId: invitation.inviterUserId,
					organizationId,
					token
				});
				await emit?.({
					at: Date.now(),
					metadata: { email: invitation.email },
					organizationId,
					type: 'invitation_created',
					userId: getUserId(user)
				});

				return status('OK', {
					invitationId: invitation.invitationId,
					token
				});
			},
			{
				body: t.Object({
					email: t.String(),
					roles: t.Optional(t.Array(t.String()))
				}),
				cookie,
				params: t.Object({ organizationId: t.String() })
			}
		)
		.get(
			`${organizationsRoute}/:organizationId/invitations`,
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
					return status('Forbidden', 'Cannot manage members');
				}

				const invitations =
					await organizationStore.listInvitationsByOrganization(
						organizationId
					);

				return status('OK', {
					invitations: invitations.map((invitation) => ({
						email: invitation.email,
						expiresAt: invitation.expiresAt,
						invitationId: invitation.invitationId,
						roles: invitation.roles,
						state: invitation.state
					}))
				});
			},
			{ cookie, params: t.Object({ organizationId: t.String() }) }
		)
		.delete(
			`${organizationsRoute}/:organizationId/invitations/:invitationId`,
			async ({
				cookie: { user_session_id },
				params: { invitationId, organizationId },
				status,
				store: { session }
			}) => {
				const user = await requireUser(user_session_id.value, session);
				if (!user) {
					return status('Unauthorized', 'Authentication required');
				}
				if (!(await mayManage(user, organizationId))) {
					return status('Forbidden', 'Cannot manage members');
				}

				const invitation =
					await organizationStore.getInvitation(invitationId);
				if (
					!invitation ||
					invitation.organizationId !== organizationId
				) {
					return status('Not Found', 'Invitation not found');
				}

				await organizationStore.saveInvitation({
					...invitation,
					state: 'revoked'
				});

				return status('OK', { revoked: invitationId });
			},
			{
				cookie,
				params: t.Object({
					invitationId: t.String(),
					organizationId: t.String()
				})
			}
		)
		.post(
			`${organizationsRoute}/invitations/accept`,
			async ({
				body: { token },
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				const user = await requireUser(user_session_id.value, session);
				if (!user) {
					return status('Unauthorized', 'Authentication required');
				}

				const membership = await acceptInvitation({
					organizationStore,
					token,
					userId: getUserId(user)
				});
				if (!membership) {
					return status(
						'Bad Request',
						'Invalid or expired invitation'
					);
				}
				await emit?.({
					at: Date.now(),
					organizationId: membership.organizationId,
					type: 'invitation_accepted',
					userId: membership.userId
				});
				await onMembershipAdded?.({
					organizationId: membership.organizationId,
					roles: membership.roles,
					userId: membership.userId
				});

				return status('OK', {
					organizationId: membership.organizationId,
					roles: membership.roles
				});
			},
			{ body: t.Object({ token: t.String() }), cookie }
		)
		.get(
			`${organizationsRoute}/:organizationId/members`,
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
				const membership = await organizationStore.getMembership(
					organizationId,
					getUserId(user)
				);
				if (membership?.status !== 'active') {
					return status('Forbidden', 'Not a member');
				}

				const members =
					await organizationStore.listMembershipsByOrganization(
						organizationId
					);

				return status('OK', { members });
			},
			{ cookie, params: t.Object({ organizationId: t.String() }) }
		)
		.delete(
			`${organizationsRoute}/:organizationId/members/:userId`,
			async ({
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
					return status('Forbidden', 'Cannot manage members');
				}

				await organizationStore.removeMembership(
					organizationId,
					userId
				);
				await emit?.({
					at: Date.now(),
					organizationId,
					type: 'membership_removed',
					userId
				});
				await onMembershipRemoved?.({ organizationId, userId });

				return status('OK', { removed: userId });
			},
			{
				cookie,
				params: t.Object({
					organizationId: t.String(),
					userId: t.String()
				})
			}
		);
};
