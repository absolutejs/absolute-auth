import { beforeEach, describe, expect, test } from 'bun:test';
import { generateEncryptionKey, generateTotpSecret } from '../src/crypto';
import { createInMemoryMfaStore } from '../src/mfa/inMemoryMfaStore';
import { rotateMfaEncryptionKey } from '../src/mfa/rotation';
import { decryptTotpSecret, encryptTotpSecret } from '../src/mfa/secret';
import type { MfaEnrollment } from '../src/mfa/types';

const oldKey = generateEncryptionKey();
const newKey = generateEncryptionKey();

const baseEnrollment = (userId: string): MfaEnrollment => ({
	backupCodeHashes: [],
	createdAt: Date.now(),
	totpVerified: true,
	updatedAt: Date.now(),
	userId
});

describe('rotateMfaEncryptionKey', () => {
	let store = createInMemoryMfaStore();

	beforeEach(() => {
		store = createInMemoryMfaStore();
	});

	test('re-encrypts every TOTP secret from the old key to the new key', async () => {
		const secretA = generateTotpSecret();
		const secretB = generateTotpSecret();
		await store.saveEnrollment({
			...baseEnrollment('a'),
			totpSecretCiphertext: await encryptTotpSecret(secretA, oldKey)
		});
		await store.saveEnrollment({
			...baseEnrollment('b'),
			totpSecretCiphertext: await encryptTotpSecret(secretB, oldKey)
		});

		const result = await rotateMfaEncryptionKey({
			mfaStore: store,
			newKey,
			oldKey
		});
		expect(result).toEqual({
			alreadyRotated: 0,
			rotated: 2,
			skippedNoSecret: 0,
			total: 2
		});

		const enrollmentA = await store.getEnrollment('a');
		const ciphertext = enrollmentA?.totpSecretCiphertext ?? '';
		// readable with the new key, no longer with the old
		expect(await decryptTotpSecret(ciphertext, newKey)).toBe(secretA);
		await expect(decryptTotpSecret(ciphertext, oldKey)).rejects.toThrow();
	});

	test('is idempotent — a re-run reports already-rotated and changes nothing', async () => {
		await store.saveEnrollment({
			...baseEnrollment('a'),
			totpSecretCiphertext: await encryptTotpSecret(
				generateTotpSecret(),
				oldKey
			)
		});

		await rotateMfaEncryptionKey({ mfaStore: store, newKey, oldKey });
		const second = await rotateMfaEncryptionKey({
			mfaStore: store,
			newKey,
			oldKey
		});
		expect(second).toEqual({
			alreadyRotated: 1,
			rotated: 0,
			skippedNoSecret: 0,
			total: 1
		});
	});

	test('skips enrollments without a TOTP secret (backup-codes only)', async () => {
		await store.saveEnrollment(baseEnrollment('a'));

		const result = await rotateMfaEncryptionKey({
			mfaStore: store,
			newKey,
			oldKey
		});
		expect(result.skippedNoSecret).toBe(1);
		expect(result.rotated).toBe(0);
	});
});
