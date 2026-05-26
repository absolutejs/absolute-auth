// Managed encrypted-blob storage on top of `createSecretCipher` (AES-GCM). One namespace per
// `ownerId` (typically a userId), keyed by `name` (e.g. 'stripe_customer'). The ciphertext
// lives in the store; the key lives in your env. Pair with `rotateVaultKey` to re-encrypt
// every entry old key → new key, mirroring `rotateMfaEncryptionKey`.

export type VaultEntry = {
	createdAt: number;
	encryptedValue: string;
	name: string;
	ownerId: string;
	updatedAt: number;
};

export type VaultStore = {
	deleteEntry: (ownerId: string, name: string) => Promise<void>;
	getEntry: (
		ownerId: string,
		name: string
	) => Promise<VaultEntry | undefined>;
	// Every entry across every owner — only used by `rotateVaultKey` (a key-rotation op runs
	// at most once per rollover, not on the hot path).
	listAllEntries: () => Promise<VaultEntry[]>;
	listEntries: (ownerId: string) => Promise<VaultEntry[]>;
	saveEntry: (entry: VaultEntry) => Promise<void>;
};
