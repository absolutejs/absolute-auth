import type { VaultEntry, VaultStore } from './types';

const keyFor = (ownerId: string, name: string) => `${ownerId}|${name}`;

export const createInMemoryVaultStore = (): VaultStore => {
	const entries = new Map<string, VaultEntry>();

	return {
		deleteEntry: async (ownerId, name) => {
			entries.delete(keyFor(ownerId, name));
		},
		getEntry: async (ownerId, name) => entries.get(keyFor(ownerId, name)),
		listAllEntries: async () => [...entries.values()].map((entry) => ({ ...entry })),
		listEntries: async (ownerId) =>
			[...entries.values()]
				.filter((entry) => entry.ownerId === ownerId)
				.map((entry) => ({ ...entry })),
		saveEntry: async (entry) => {
			entries.set(keyFor(entry.ownerId, entry.name), { ...entry });
		}
	};
};
