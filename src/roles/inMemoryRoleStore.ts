import type { Role, RoleStore } from './types';

// Global roles (no organizationId) are keyed under the empty-string scope.
const roleKey = (slug: string, organizationId?: string) =>
	`${organizationId ?? ''}\t${slug}`;

const cloneRole = (value: Role): Role => ({
	...value,
	permissions: [...value.permissions]
});

export const createInMemoryRoleStore = (): RoleStore => {
	const roles = new Map<string, Role>();

	return {
		deleteRole: async (slug, organizationId) => {
			roles.delete(roleKey(slug, organizationId));
		},
		getRole: async (slug, organizationId) => {
			const role = roles.get(roleKey(slug, organizationId));

			return role ? cloneRole(role) : undefined;
		},
		listRoles: async (organizationId) =>
			[...roles.values()]
				.filter((role) => role.organizationId === organizationId)
				.map(cloneRole),
		saveRole: async (role) => {
			roles.set(roleKey(role.slug, role.organizationId), cloneRole(role));
		}
	};
};
