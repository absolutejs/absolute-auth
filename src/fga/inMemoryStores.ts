import type { Warrant, WarrantStore } from './types';

// Deterministic identity for a warrant (so saving the same tuple twice dedupes).
export const createInMemoryWarrantStore = (): WarrantStore => {
	const warrants = new Map<string, Warrant>();

	return {
		deleteWarrant: async (warrant) => {
			warrants.delete(warrantKey(warrant));
		},
		listForResource: async (resourceType, resourceId, relation) =>
			[...warrants.values()].filter(
				(warrant) =>
					warrant.resourceType === resourceType &&
					warrant.resourceId === resourceId &&
					warrant.relation === relation
			),
		saveWarrant: async (warrant) => {
			warrants.set(warrantKey(warrant), { ...warrant });
		}
	};
};
export const warrantKey = (warrant: Warrant) =>
	`${warrant.resourceType}:${warrant.resourceId}#${warrant.relation}@${warrant.subjectType}:${warrant.subjectId}#${warrant.subjectRelation ?? ''}`;
