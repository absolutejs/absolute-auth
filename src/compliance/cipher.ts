import { decryptSecret, encryptSecret } from '../crypto';

export type SecretCipher = {
	decrypt: (ciphertext: string) => Promise<string>;
	encrypt: (plaintext: string) => Promise<string>;
};

// Binds an AES-GCM key (F2) so stores can encrypt sensitive fields at rest without threading the
// key through every call. `createSecretCipher(key).encrypt(plaintext)` / `.decrypt(ciphertext)`.
// The key is 32 url-safe bytes from `generateEncryptionKey()`; keep it out of the database.
export const createSecretCipher = (keyMaterial: string): SecretCipher => ({
	decrypt: (ciphertext) => decryptSecret(ciphertext, keyMaterial),
	encrypt: (plaintext) => encryptSecret(plaintext, keyMaterial)
});
