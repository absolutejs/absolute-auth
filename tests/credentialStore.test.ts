import { describe, expect, test } from 'bun:test';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import type { CredentialRecord } from '../src/credentials/types';

const HOUR_MS = 3_600_000;

const sampleCredential = (
	overrides: Partial<CredentialRecord> = {}
): CredentialRecord => ({
	createdAt: Date.now(),
	email: 'User@Example.com',
	emailVerified: false,
	passwordHash: 'argon2id-hash',
	status: 'active',
	updatedAt: Date.now(),
	...overrides
});

describe('in-memory credential store', () => {
	test('saves and retrieves a credential by normalized email', async () => {
		const store = createInMemoryCredentialStore();

		await store.saveCredential(sampleCredential());
		const found = await store.getCredentialByEmail('user@example.com');

		expect(found?.passwordHash).toBe('argon2id-hash');
		expect(found?.emailVerified).toBe(false);
	});

	test('setEmailVerified flips the flag', async () => {
		const store = createInMemoryCredentialStore();

		await store.saveCredential(sampleCredential());
		await store.setEmailVerified('USER@example.com');
		const found = await store.getCredentialByEmail('user@example.com');

		expect(found?.emailVerified).toBe(true);
	});

	test('verification tokens are single-use', async () => {
		const store = createInMemoryCredentialStore();

		await store.saveVerificationToken({
			email: 'a@b.com',
			expiresAt: Date.now() + HOUR_MS,
			tokenHash: 'verify-hash'
		});

		expect(
			(await store.consumeVerificationToken('verify-hash'))?.email
		).toBe('a@b.com');
		expect(
			await store.consumeVerificationToken('verify-hash')
		).toBeUndefined();
	});

	test('expired reset tokens are rejected and consumed', async () => {
		const store = createInMemoryCredentialStore();

		await store.saveResetToken({
			email: 'a@b.com',
			expiresAt: Date.now() - HOUR_MS,
			tokenHash: 'reset-hash'
		});

		expect(await store.consumeResetToken('reset-hash')).toBeUndefined();
	});
});
