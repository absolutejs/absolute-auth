import { createSecretCipher, type SecretCipher } from '../compliance/cipher';
import type { VaultStore } from './types';

// The consumer-facing handle: put/get/delete a named encrypted value for one owner, and list
// the names that owner has. `put` is upsert (createdAt is preserved across updates).
export type Vault = {
	delete: (ownerId: string, name: string) => Promise<void>;
	get: (ownerId: string, name: string) => Promise<string | undefined>;
	list: (ownerId: string) => Promise<string[]>;
	put: (ownerId: string, name: string, value: string) => Promise<void>;
};

export const createVault = ({
	cipher,
	store
}: {
	cipher: SecretCipher;
	store: VaultStore;
}): Vault => ({
	delete: (ownerId, name) => store.deleteEntry(ownerId, name),
	get: async (ownerId, name) => {
		const entry = await store.getEntry(ownerId, name);
		if (entry === undefined) return undefined;
		const plaintext = await cipher.decrypt(entry.encryptedValue);
		if (cipher.needsReencryption?.(entry.encryptedValue)) {
			await store.saveEntry({
				...entry,
				encryptedValue: await cipher.encrypt(plaintext),
				updatedAt: Date.now()
			});
		}

		return plaintext;
	},
	list: async (ownerId) =>
		(await store.listEntries(ownerId)).map((entry) => entry.name),
	put: async (ownerId, name, value) => {
		const now = Date.now();
		const existing = await store.getEntry(ownerId, name);
		await store.saveEntry({
			createdAt: existing?.createdAt ?? now,
			encryptedValue: await cipher.encrypt(value),
			name,
			ownerId,
			updatedAt: now
		});
	}
});

export type VaultKeyRotationResult = {
	rotated: number;
};

// Re-encrypt every vault entry from `oldKey` to `newKey`. Run once per key rollover, then
// swap your env to `newKey`. Mirrors `rotateMfaEncryptionKey`'s shape.
export const rotateVaultKey = async ({
	newKey,
	oldKey,
	store
}: {
	newKey: string;
	oldKey: string;
	store: VaultStore;
}): Promise<VaultKeyRotationResult> => {
	const oldCipher = createSecretCipher(oldKey);
	const newCipher = createSecretCipher(newKey);
	const entries = await store.listAllEntries();
	const now = Date.now();
	await entries.reduce(async (pending, entry) => {
		await pending;
		const plaintext = await oldCipher.decrypt(entry.encryptedValue);
		const encryptedValue = await newCipher.encrypt(plaintext);
		await store.saveEntry({ ...entry, encryptedValue, updatedAt: now });
	}, Promise.resolve());

	return { rotated: entries.length };
};
