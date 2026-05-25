import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type {
	CredentialEmailMessage,
	CredentialsConfig
} from '../src/credentials/config';
import { credentialsEmailVerification } from '../src/credentials/emailVerification';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { credentialsRegister } from '../src/credentials/register';

type TestUser = {
	email: string;
	sub: string;
};

const buildHarness = () => {
	const credentialStore = createInMemoryCredentialStore();
	const sent: CredentialEmailMessage[] = [];
	const config: CredentialsConfig<TestUser> = {
		credentialStore,
		passwordPolicy: { minLength: 8 },
		getUserByEmail: async () => null,
		onCreateCredentialUser: ({ email }) => ({ email, sub: `user:${email}` }),
		onSendEmail: (message) => {
			sent.push(message);
		}
	};
	const app = new Elysia()
		.use(credentialsRegister(config))
		.use(credentialsEmailVerification(config));

	return { app, credentialStore, sent };
};

const postJson = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	body: unknown
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		})
	);

describe('credential registration + verification flow', () => {
	test('registers, emails a token, and verifies the email', async () => {
		const { app, credentialStore, sent } = buildHarness();

		const registered = await postJson(app, '/auth/register', {
			email: 'New@Example.com',
			password: 'supersecret'
		});

		expect(registered.status).toBe(201);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.type).toBe('verify_email');

		const before =
			await credentialStore.getCredentialByEmail('new@example.com');
		expect(before?.emailVerified).toBe(false);

		const verified = await postJson(app, '/auth/verify-email', {
			token: sent[0]?.token ?? ''
		});

		expect(verified.status).toBe(200);
		const after =
			await credentialStore.getCredentialByEmail('new@example.com');
		expect(after?.emailVerified).toBe(true);
	});

	test('rejects weak passwords and duplicate registrations', async () => {
		const { app } = buildHarness();

		const weak = await postJson(app, '/auth/register', {
			email: 'a@b.com',
			password: 'short'
		});
		expect(weak.status).toBe(400);

		const first = await postJson(app, '/auth/register', {
			email: 'dup@b.com',
			password: 'supersecret'
		});
		expect(first.status).toBe(201);

		const second = await postJson(app, '/auth/register', {
			email: 'dup@b.com',
			password: 'supersecret'
		});
		expect(second.status).toBe(409);
	});

	test('rejects an invalid verification token', async () => {
		const { app } = buildHarness();

		const response = await postJson(app, '/auth/verify-email', {
			token: 'not-a-real-token'
		});

		expect(response.status).toBe(400);
	});
});
