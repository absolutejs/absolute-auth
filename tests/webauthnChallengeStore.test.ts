import { describe, expect, test } from 'bun:test';
import {
	createInMemoryWebAuthnChallengeStore,
	type WebAuthnChallenge
} from '../src/webauthn/challengeStore';
import { createInMemoryWebAuthnCredentialStore } from '../src/webauthn/inMemoryWebAuthnCredentialStore';

const challenge: WebAuthnChallenge = {
	challenge: 'public-challenge',
	expiresAt: 200,
	id: 'challenge-id',
	purpose: 'approval',
	sessionId: 'session-a',
	userId: 'alice'
};
const consume = {
	id: challenge.id,
	now: 100,
	purpose: challenge.purpose,
	sessionId: challenge.sessionId,
	userId: challenge.userId
};
describe('one-use WebAuthn challenges', () => {
	test('only one concurrent consumer wins', async () => {
		const store = createInMemoryWebAuthnChallengeStore();
		await store.save(challenge);
		const results = await Promise.all(
			Array.from({ length: 10 }, () => store.consume(consume))
		);
		expect(results.filter(Boolean)).toHaveLength(1);
	});
	test('requires matching purpose, owner and session without burning a valid challenge', async () => {
		const store = createInMemoryWebAuthnChallengeStore();
		await store.save(challenge);
		expect(
			await store.consume({ ...consume, purpose: 'authentication' })
		).toBeUndefined();
		expect(
			await store.consume({ ...consume, userId: 'bob' })
		).toBeUndefined();
		expect(
			await store.consume({ ...consume, sessionId: 'session-b' })
		).toBeUndefined();
		expect(await store.consume(consume)).toEqual(challenge);
	});
	test('expires at the exact deadline and refuses identifier overwrite', async () => {
		const store = createInMemoryWebAuthnChallengeStore();
		await store.save(challenge);
		await expect(
			store.save({ ...challenge, userId: 'bob' })
		).rejects.toThrow('already exists');
		expect(
			await store.consume({ ...consume, now: challenge.expiresAt })
		).toBeUndefined();
	});
});
describe('WebAuthn credential ownership', () => {
	test('cannot transfer ownership, replace a key, or roll back its counter', async () => {
		const store = createInMemoryWebAuthnCredentialStore();
		const original = {
			counter: 5,
			createdAt: 10,
			credentialId: 'credential',
			publicKey: 'public-key',
			userId: 'alice'
		};
		await store.saveCredential(original);
		await expect(
			store.saveCredential({ ...original, userId: 'bob' })
		).rejects.toThrow();
		await expect(
			store.saveCredential({ ...original, publicKey: 'replacement' })
		).rejects.toThrow();
		await expect(
			store.saveCredential({ ...original, counter: 4 })
		).rejects.toThrow();
		expect(await store.getCredential(original.credentialId)).toEqual(
			original
		);
		await store.saveCredential({ ...original, counter: 6 });
		expect(
			(await store.getCredential(original.credentialId))?.counter
		).toBe(6);
	});
});
