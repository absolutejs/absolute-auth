import type { AuditEmitter } from '../audit/config';
import type {
	OrganizationMembership,
	OrganizationStore
} from '../organizations/types';
import type { AuthSessionStore } from '../session/types';
import type { OrganizationId } from '../tenancy';
import type { RouteString } from '../types';
import type { RoleStore } from './types';

export const DEFAULT_ROLES_ROUTE: RouteString = '/auth/roles';

// Org-scoped roles & permissions (builds on the organizations block). Optional. When present,
// `auth()` mounts routes to list an org's role definitions and set a member's roles. Pair with
// `createMembershipPermissionResolver` to make `authorization.hasPermission` turnkey.
export type RolesConfig<UserType> = {
	getUserId: (user: UserType) => string;
	organizationStore: OrganizationStore;
	roleStore: RoleStore;
	// Gate role assignment (default: caller is an active member). Override to require, e.g.,
	// the 'admin' role.
	canManageRoles?: (context: {
		membership?: OrganizationMembership;
		organizationId: OrganizationId;
		user: UserType;
	}) => boolean | Promise<boolean>;
	onRolesAssigned?: (context: {
		organizationId: OrganizationId;
		roles: string[];
		userId: string;
	}) => void | Promise<void>;
	rolesRoute?: RouteString;
};

export type RolesRouteProps<UserType> = RolesConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
	emit?: AuditEmitter;
};
