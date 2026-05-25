import type { OrganizationId } from '../tenancy';

export type Organization = {
	createdAt: number;
	metadata?: Record<string, unknown>;
	name: string;
	organizationId: OrganizationId;
	updatedAt: number;
};

export type MembershipStatus = 'active' | 'suspended';

export type OrganizationMembership = {
	createdAt: number;
	organizationId: OrganizationId;
	// Org-scoped role slugs. Free-form here; the roles store (Phase 2) maps them → permissions.
	roles: string[];
	status: MembershipStatus;
	updatedAt: number;
	userId: string;
};

export type InvitationState = 'accepted' | 'pending' | 'revoked';

export type OrganizationInvitation = {
	acceptedAt?: number;
	createdAt: number;
	email: string;
	expiresAt: number;
	invitationId: string;
	inviterUserId?: string;
	organizationId: OrganizationId;
	roles: string[];
	state: InvitationState;
	// SHA-256 hash of the single-use token; the plaintext is returned once at creation.
	tokenHash: string;
};

// Persistence for the tenant model: organizations, user↔org memberships, and email invitations.
// One cohesive store (three tables in the Postgres impl) since the three are tightly coupled.
export type OrganizationStore = {
	deleteOrganization: (organizationId: OrganizationId) => Promise<void>;
	getInvitation: (
		invitationId: string
	) => Promise<OrganizationInvitation | undefined>;
	getInvitationByTokenHash: (
		tokenHash: string
	) => Promise<OrganizationInvitation | undefined>;
	getMembership: (
		organizationId: OrganizationId,
		userId: string
	) => Promise<OrganizationMembership | undefined>;
	getOrganization: (
		organizationId: OrganizationId
	) => Promise<Organization | undefined>;
	listInvitationsByOrganization: (
		organizationId: OrganizationId
	) => Promise<OrganizationInvitation[]>;
	listMembershipsByOrganization: (
		organizationId: OrganizationId
	) => Promise<OrganizationMembership[]>;
	listMembershipsByUser: (
		userId: string
	) => Promise<OrganizationMembership[]>;
	removeMembership: (
		organizationId: OrganizationId,
		userId: string
	) => Promise<void>;
	saveInvitation: (invitation: OrganizationInvitation) => Promise<void>;
	saveMembership: (membership: OrganizationMembership) => Promise<void>;
	saveOrganization: (organization: Organization) => Promise<void>;
};
