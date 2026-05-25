import { generateSecureToken, hashToken } from '../crypto';
import type { OrganizationId } from '../tenancy';
import { DEFAULT_INVITATION_TTL_MS, DEFAULT_OWNER_ROLES } from './config';
import type {
	Organization,
	OrganizationInvitation,
	OrganizationMembership,
	OrganizationStore
} from './types';

// Store-backed primitives shared by the routes and reusable directly (e.g. seeding an org during
// signup). Each is pure aside from the store calls, so they unit-test without an HTTP layer.

export const acceptInvitation = async ({
	organizationStore,
	token,
	userId
}: {
	organizationStore: OrganizationStore;
	token: string;
	userId: string;
}) => {
	const invitation = await organizationStore.getInvitationByTokenHash(
		await hashToken(token)
	);
	if (!invitation || invitation.state !== 'pending') return undefined;
	if (invitation.expiresAt < Date.now()) return undefined;

	const now = Date.now();
	await organizationStore.saveInvitation({
		...invitation,
		acceptedAt: now,
		state: 'accepted'
	});
	const membership: OrganizationMembership = {
		createdAt: now,
		organizationId: invitation.organizationId,
		roles: invitation.roles,
		status: 'active',
		updatedAt: now,
		userId
	};
	await organizationStore.saveMembership(membership);

	return membership;
};
export const createOrganization = async ({
	metadata,
	name,
	organizationStore,
	ownerRoles = DEFAULT_OWNER_ROLES,
	ownerUserId
}: {
	metadata?: Record<string, unknown>;
	name: string;
	organizationStore: OrganizationStore;
	ownerRoles?: string[];
	ownerUserId: string;
}) => {
	const now = Date.now();
	const organization: Organization = {
		createdAt: now,
		metadata,
		name,
		organizationId: crypto.randomUUID(),
		updatedAt: now
	};
	await organizationStore.saveOrganization(organization);
	await organizationStore.saveMembership({
		createdAt: now,
		organizationId: organization.organizationId,
		roles: ownerRoles,
		status: 'active',
		updatedAt: now,
		userId: ownerUserId
	});

	return organization;
};
export const inviteToOrganization = async ({
	email,
	invitationDurationMs = DEFAULT_INVITATION_TTL_MS,
	inviterUserId,
	organizationId,
	organizationStore,
	roles = []
}: {
	email: string;
	invitationDurationMs?: number;
	inviterUserId?: string;
	organizationId: OrganizationId;
	organizationStore: OrganizationStore;
	roles?: string[];
}) => {
	const token = generateSecureToken();
	const now = Date.now();
	const invitation: OrganizationInvitation = {
		createdAt: now,
		email: email.trim().toLowerCase(),
		expiresAt: now + invitationDurationMs,
		invitationId: crypto.randomUUID(),
		inviterUserId,
		organizationId,
		roles,
		state: 'pending',
		tokenHash: await hashToken(token)
	};
	await organizationStore.saveInvitation(invitation);

	return { invitation, token };
};
export const listUserOrganizations = async ({
	organizationStore,
	userId
}: {
	organizationStore: OrganizationStore;
	userId: string;
}) => {
	const memberships = await organizationStore.listMembershipsByUser(userId);
	const organizations = await Promise.all(
		memberships.map((membership) =>
			organizationStore.getOrganization(membership.organizationId)
		)
	);

	return memberships.map((membership, index) => ({
		membership,
		organization: organizations[index]
	}));
};
