import { describe, expect, test } from 'bun:test';
import { createInMemoryMfaStore } from '../src/mfa/inMemoryMfaStore';
import { isMfaEnrolled, type MfaEnrollment } from '../src/mfa/types';

const sampleEnrollment = (
	overrides: Partial<MfaEnrollment> = {}
): MfaEnrollment => ({
	backupCodeHashes: ['hash-1', 'hash-2'],
	createdAt: Date.now(),
	totpSecretCiphertext: 'cipher',
	totpVerified: true,
	updatedAt: Date.now(),
	userId: 'user-1',
	...overrides
});

describe('in-memory MFA store', () => {
	test('saves and retrieves an enrollment', async () => {
		const store = createInMemoryMfaStore();

		await store.saveEnrollment(sampleEnrollment());
		const found = await store.getEnrollment('user-1');

		expect(found?.totpVerified).toBe(true);
		expect(found?.backupCodeHashes).toEqual(['hash-1', 'hash-2']);
	});

	test('clones backup codes so external mutation does not leak in', async () => {
		const store = createInMemoryMfaStore();
		const enrollment = sampleEnrollment();

		await store.saveEnrollment(enrollment);
		enrollment.backupCodeHashes.push('hash-3');
		const found = await store.getEnrollment('user-1');

		expect(found?.backupCodeHashes).toHaveLength(2);
	});

	test('removes an enrollment', async () => {
		const store = createInMemoryMfaStore();

		await store.saveEnrollment(sampleEnrollment());
		await store.removeEnrollment('user-1');

		expect(await store.getEnrollment('user-1')).toBeUndefined();
	});
});

describe('isMfaEnrolled', () => {
	test('is true with a verified TOTP or remaining backup codes', () => {
		expect(
			isMfaEnrolled(
				sampleEnrollment({ backupCodeHashes: [], totpVerified: true })
			)
		).toBe(true);
		expect(
			isMfaEnrolled(
				sampleEnrollment({
					backupCodeHashes: ['x'],
					totpVerified: false
				})
			)
		).toBe(true);
	});

	test('is false when unenrolled or only an unverified secret exists', () => {
		expect(isMfaEnrolled(undefined)).toBe(false);
		expect(
			isMfaEnrolled(
				sampleEnrollment({ backupCodeHashes: [], totpVerified: false })
			)
		).toBe(false);
	});
});
