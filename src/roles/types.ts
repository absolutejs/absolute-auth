import type { OrganizationId } from '../tenancy';

export type Role = {
	createdAt: number;
	// undefined = a global role available to every organization; otherwise org-scoped.
	organizationId?: OrganizationId;
	permissions: string[];
	slug: string;
	updatedAt: number;
};

// Role definitions (slug → permission slugs). Assignment of roles to users lives on the
// organization membership (`membership.roles`), so this store only holds the definitions.
export type RoleStore = {
	deleteRole: (
		slug: string,
		organizationId?: OrganizationId
	) => Promise<void>;
	getRole: (
		slug: string,
		organizationId?: OrganizationId
	) => Promise<Role | undefined>;
	listRoles: (organizationId?: OrganizationId) => Promise<Role[]>;
	saveRole: (role: Role) => Promise<void>;
};
