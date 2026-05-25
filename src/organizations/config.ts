import type { AuditEmitter } from '../audit/config';
import { MILLISECONDS_IN_A_DAY } from '../constants';
import type { AuthSessionStore } from '../session/types';
import type { OrganizationId } from '../tenancy';
import type { RouteString } from '../types';
import type { OrganizationMembership, OrganizationStore } from './types';

const INVITATION_TTL_DAYS = 7;

export const DEFAULT_INVITATION_TTL_MS =
	MILLISECONDS_IN_A_DAY * INVITATION_TTL_DAYS;
export const DEFAULT_ORGANIZATIONS_ROUTE: RouteString = '/auth/organizations';
export const DEFAULT_OWNER_ROLES = ['owner'];

// The invitation email payload. The link the consumer sends must embed `token` (the single-use
// plaintext, surfaced only here) pointing at the accept route / their accept page.
export type OrganizationInvitationMessage = {
	email: string;
	expiresAt: number;
	inviterUserId?: string;
	organizationId: OrganizationId;
	token: string;
};

// First-class multi-tenancy (the WorkOS model). Additive and optional. When present, `auth()`
// mounts organization + membership + invitation routes. The package owns the store wiring,
// tokenized invite flow, and the default "active member" management gate; the consumer owns the
// user table (mapped via `getUserId`) and any tighter authorization via the optional hooks.
export type OrganizationsConfig<UserType> = {
	getUserId: (user: UserType) => string;
	organizationStore: OrganizationStore;
	// Gate org creation (default: any authenticated user may create one and becomes its owner).
	canCreateOrganization?: (user: UserType) => boolean | Promise<boolean>;
	// Gate member management — invite / list / revoke / remove (default: caller is an active
	// member). Override to require a specific role, e.g. membership?.roles.includes('admin').
	canManageMembers?: (context: {
		membership?: OrganizationMembership;
		organizationId: OrganizationId;
		user: UserType;
	}) => boolean | Promise<boolean>;
	invitationDurationMs?: number;
	onMembershipAdded?: (context: {
		organizationId: OrganizationId;
		roles: string[];
		userId: string;
	}) => void | Promise<void>;
	onMembershipRemoved?: (context: {
		organizationId: OrganizationId;
		userId: string;
	}) => void | Promise<void>;
	onOrganizationCreated?: (context: {
		organizationId: OrganizationId;
		ownerUserId: string;
	}) => void | Promise<void>;
	// Deliver the invitation email. Optional — when omitted, the plaintext token is still returned
	// from the invite route so the consumer can deliver it however they like.
	onSendInvitation?: (
		message: OrganizationInvitationMessage
	) => void | Promise<void>;
	organizationsRoute?: RouteString;
	// Roles granted to the creator of a new organization (default `['owner']`).
	ownerRoles?: string[];
};

export type OrganizationsRouteProps<UserType> =
	OrganizationsConfig<UserType> & {
		authSessionStore?: AuthSessionStore<UserType>;
		emit?: AuditEmitter;
	};
