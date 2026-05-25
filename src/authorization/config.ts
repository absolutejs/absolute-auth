import type { AuditEmitter } from '../audit/config';
import type { AuthSessionStore } from '../session/types';
import type { OrganizationId } from '../tenancy';

// The descriptor handed to the consumer's `hasPermission` hook for every guarded action.
// `organizationId` is optional so the same hook serves both global and per-tenant checks; the
// package stays unopinionated about how roles/permissions are modeled — that lives in the consumer.
export type PermissionContext<UserType> = {
	organizationId?: OrganizationId;
	permission: string;
	user: UserType;
};

// Role-based / attribute-based access control, delegated entirely to the consumer. `auth()`
// exposes the `protectPermission` derive (alongside `protectRoute`) only when this block is
// supplied; the package never models roles or permissions itself.
export type AuthorizationConfig<UserType> = {
	hasPermission: (
		context: PermissionContext<UserType>
	) => boolean | Promise<boolean>;
};

// The check descriptor supplied at each `protectPermission(...)` call site.
export type PermissionCheck = {
	organizationId?: OrganizationId;
	permission: string;
};

export type AuthorizationPluginProps<UserType> =
	AuthorizationConfig<UserType> & {
		authSessionStore?: AuthSessionStore<UserType>;
		// When `auth()` has an audit block, denied checks are recorded as `authorization_denied`.
		emit?: AuditEmitter;
	};
