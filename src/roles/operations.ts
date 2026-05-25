import type {
	OrganizationMembership,
	OrganizationStore
} from '../organizations/types';
import type { OrganizationId } from '../tenancy';

// Replace a member's org-scoped role slugs. Returns the updated membership, or undefined when the
// user is not a member of the organization.
export const setMemberRoles = async ({
	organizationId,
	organizationStore,
	roles,
	userId
}: {
	organizationId: OrganizationId;
	organizationStore: OrganizationStore;
	roles: string[];
	userId: string;
}) => {
	const membership = await organizationStore.getMembership(
		organizationId,
		userId
	);
	if (!membership) return undefined;

	const updated: OrganizationMembership = {
		...membership,
		roles,
		updatedAt: Date.now()
	};
	await organizationStore.saveMembership(updated);

	return updated;
};
