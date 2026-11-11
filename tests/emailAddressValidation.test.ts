import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { normalizeEmailAddress } from '../src/emailAddress';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { credentialsRegister } from '../src/credentials/register';
const invalid = [
	'person@example',
	'person@@example.com',
	'.person@example.com',
	'person@bad_domain.com',
	'person@example.com/path',
	'person@example.com:443',
	'person@example.com?x=y',
	'person@example.com#x',
	'person@%65xample.com',
	'person@example.com\\path',
	'person@ example.com',
	'person@-example.com',
	'person@example..com'
];
test('email normalization accepts aliases and IDNs without accepting URL syntax', () => {
	for (const email of invalid)
		expect(normalizeEmailAddress(email)).toBeNull();
	for (const tld of ['io', 'ai', 'co'])
		expect(normalizeEmailAddress(`User+Tag@Example.${tld}`)).toBe(
			`user+tag@example.${tld}`
		);
	expect(normalizeEmailAddress('  Name@bücher.example ')).toBe(
		'name@xn--bcher-kva.example'
	);
});
test('registration rejects malformed emails before storing credentials or sending verification', async () => {
	const store = createInMemoryCredentialStore();
	let sends = 0;
	const app = new Elysia().use(
		credentialsRegister({
			credentialStore: store,
			requireEmailVerification: true,
			getUserByEmail: () => null,
			onCreateCredentialUser: () => null,
			onSendEmail: async () => {
				sends++;
			}
		})
	);
	await Promise.all(invalid.map(async (email) => {
		const response = await app.handle(
			new Request('http://localhost/auth/register', {
				body: JSON.stringify({
					email,
					password: 'Test-only-Strong!123'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain('name@example.com');
		expect(await store.getCredentialByEmail(email)).toBeUndefined();
	}));
	expect(sends).toBe(0);
});
