import type { OrganizationStore } from '../organizations/types';
import type { OrganizationId } from '../tenancy';
import type { RoleStore } from './types';

const WILDCARD = '*';

// Union the permission slugs granted by a set of role slugs, resolving each role org-scoped first
// then falling back to a global role of the same slug.
export const createMembershipPermissionResolver =
	<UserType>({
		getUserId,
		organizationStore,
		roleStore
	}: {
		getUserId: (user: UserType) => string;
		organizationStore: OrganizationStore;
		roleStore: RoleStore;
	}) =>
	async ({
		organizationId,
		permission,
		user
	}: {
		organizationId?: OrganizationId;
		permission: string;
		user: UserType;
	}) => {
		if (organizationId === undefined) return false;
		const membership = await organizationStore.getMembership(
			organizationId,
			getUserId(user)
		);
		if (membership?.status !== 'active') return false;

		const permissions = await resolvePermissions({
			organizationId,
			roles: membership.roles,
			roleStore
		});

		return permissions.has(WILDCARD) || permissions.has(permission);
	};
export const resolvePermissions = async ({
	organizationId,
	roleStore,
	roles
}: {
	organizationId?: OrganizationId;
	roleStore: RoleStore;
	roles: string[];
}) => {
	const resolved = await Promise.all(
		roles.map(async (slug) => {
			const scoped =
				organizationId === undefined
					? undefined
					: await roleStore.getRole(slug, organizationId);
			const role = scoped ?? (await roleStore.getRole(slug));

			return role?.permissions ?? [];
		})
	);

	return new Set(resolved.flat());
};
