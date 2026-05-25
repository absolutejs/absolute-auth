import { decryptSecret, encryptSecret } from '../crypto';

// When an encryption key is configured the TOTP secret is AES-GCM encrypted at rest,
// otherwise it round-trips unchanged (dev). Centralised so setup, verify and challenge
// all treat the stored secret identically.
export const decryptTotpSecret = (
	ciphertext: string,
	encryptionKey?: string
) =>
	encryptionKey
		? decryptSecret(ciphertext, encryptionKey)
		: Promise.resolve(ciphertext);
export const encryptTotpSecret = (secret: string, encryptionKey?: string) =>
	encryptionKey
		? encryptSecret(secret, encryptionKey)
		: Promise.resolve(secret);
