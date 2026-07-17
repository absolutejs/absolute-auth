import { decryptSecret, encryptSecret } from '../crypto';

export type SecretCipher = {
	decrypt: (ciphertext: string) => Promise<string>;
	encrypt: (plaintext: string) => Promise<string>;
	needsReencryption?: (ciphertext: string) => boolean;
};

// Binds an AES-GCM key (F2) so stores can encrypt sensitive fields at rest without threading the
// key through every call. `createSecretCipher(key).encrypt(plaintext)` / `.decrypt(ciphertext)`.
// The key is 32 url-safe bytes from `generateEncryptionKey()`; keep it out of the database.
export const createSecretCipher = (keyMaterial: string): SecretCipher => ({
	decrypt: (ciphertext) => decryptSecret(ciphertext, keyMaterial),
	encrypt: (plaintext) => encryptSecret(plaintext, keyMaterial)
});

const VERSIONED_CIPHERTEXT_PREFIX = 'absolute-vault';
const VERSIONED_CIPHERTEXT_SEGMENTS = 3;

const parseVersionedCiphertext = (value: string) => {
	const [prefix, encodedVersion, ciphertext] = value.split(
		':',
		VERSIONED_CIPHERTEXT_SEGMENTS
	);
	if (
		prefix !== VERSIONED_CIPHERTEXT_PREFIX ||
		!encodedVersion ||
		!ciphertext
	)
		return null;
	const version = Number(encodedVersion);
	if (!Number.isSafeInteger(version) || version < 1) return null;

	return { ciphertext, version };
};

export const createVersionedSecretCipher = ({
	currentVersion,
	keys,
	legacyKey
}: {
	currentVersion: number;
	keys: Readonly<Record<number, string>>;
	legacyKey?: string;
}): SecretCipher => {
	if (!Number.isSafeInteger(currentVersion) || currentVersion < 1)
		throw new Error('Vault key version must be a positive integer');
	const currentKey = keys[currentVersion];
	if (!currentKey)
		throw new Error(`Vault key version ${currentVersion} is unavailable`);

	return {
		decrypt: async (value) => {
			const envelope = parseVersionedCiphertext(value);
			if (!envelope) {
				if (!legacyKey)
					throw new Error(
						'Legacy vault ciphertext key is unavailable'
					);

				return decryptSecret(value, legacyKey);
			}
			const key = keys[envelope.version];
			if (!key)
				throw new Error(
					`Vault key version ${envelope.version} is unavailable`
				);

			return decryptSecret(envelope.ciphertext, key);
		},
		encrypt: async (plaintext) =>
			`${VERSIONED_CIPHERTEXT_PREFIX}:${currentVersion}:${await encryptSecret(plaintext, currentKey)}`,
		needsReencryption: (value) =>
			parseVersionedCiphertext(value)?.version !== currentVersion
	};
};
