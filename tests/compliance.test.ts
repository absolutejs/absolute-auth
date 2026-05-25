import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { AuditEvent } from '../src/audit/types';
import { createSecretCipher } from '../src/compliance/cipher';
import { createAuditRedactor } from '../src/compliance/redaction';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { generateEncryptionKey } from '../src/crypto';
import { auth } from '../src/index';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

type TestUser = {
	email: string;
	sub: string;
};

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;

const buildApp = async () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const credentialStore = createInMemoryCredentialStore();
	const users = new Map<string, TestUser>();
	const deleted: string[] = [];
	const authInstance = await auth<TestUser>({
		authSessionStore,
		compliance: {
			deleteUserData: ({ user }) => {
				deleted.push(user.email);
				users.delete(user.email);
			},
			exportUserData: ({ user }) => ({
				email: user.email,
				sub: user.sub
			}),
			getUserId: (user) => user.sub
		},
		credentials: {
			credentialStore,
			passwordPolicy: { minLength: 8 },
			getUserByEmail: (email) => users.get(email) ?? null,
			onCreateCredentialUser: ({ email }) => {
				const user: TestUser = { email, sub: `user:${email}` };
				users.set(email, user);

				return user;
			},
			onSendEmail: () => undefined
		},
		providersConfiguration: {},
		sessions: { getUserId: (user) => user.sub }
	});

	return { app: new Elysia().use(authInstance), authSessionStore, deleted };
};

const post = (
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

const send = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	method: string,
	cookie: string
) =>
	app.handle(
		new Request(`http://localhost${path}`, { headers: { cookie }, method })
	);

const cookieFrom = (response: Response) =>
	response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('user_session_id='))
		?.split(';')[0] ?? '';

describe('compliance routes', () => {
	test('exports the caller’s data', async () => {
		const { app } = await buildApp();
		const credentials: { email: string; password: string } = {
			email: 'export@example.com',
			password: 'supersecret'
		};
		const cookie = cookieFrom(
			await post(app, '/auth/register', credentials)
		);

		const response = await send(app, '/auth/account/export', 'GET', cookie);

		expect(response.status).toBe(HTTP_OK);
		expect((await response.json()).email).toBe('export@example.com');
	});

	test('export requires authentication', async () => {
		const { app } = await buildApp();

		const response = await send(
			app,
			'/auth/account/export',
			'GET',
			'user_session_id=00000000-0000-4000-8000-000000000000'
		);

		expect(response.status).toBe(HTTP_UNAUTHORIZED);
	});

	test('deletes the account and revokes every session the user holds', async () => {
		const { app, deleted } = await buildApp();
		const credentials: { email: string; password: string } = {
			email: 'erase@example.com',
			password: 'supersecret'
		};
		const firstCookie = cookieFrom(
			await post(app, '/auth/register', credentials)
		);
		const secondCookie = cookieFrom(
			await post(app, '/auth/login', credentials)
		);

		const response = await send(
			app,
			'/auth/account',
			'DELETE',
			secondCookie
		);

		expect(response.status).toBe(HTTP_OK);
		expect((await response.json()).deleted).toBe(true);
		expect(deleted).toContain('erase@example.com');

		// The caller's session AND the sibling session are both revoked.
		expect(
			(await send(app, '/auth/account/export', 'GET', secondCookie))
				.status
		).toBe(HTTP_UNAUTHORIZED);
		expect(
			(await send(app, '/auth/account/export', 'GET', firstCookie)).status
		).toBe(HTTP_UNAUTHORIZED);
	});
});

describe('createAuditRedactor', () => {
	test('drops and hashes the configured metadata fields', async () => {
		const redact = createAuditRedactor({
			dropFields: ['ssn'],
			hashFields: ['email'],
			redactIp: true
		});
		const event: AuditEvent = {
			at: 1,
			ip: '1.2.3.4',
			metadata: { email: 'a@b.com', kept: 'yes', ssn: '000-00-0000' },
			type: 'register'
		};

		const result = await redact(event);

		expect(result.ip).toBeUndefined();
		expect(result.metadata?.ssn).toBeUndefined();
		expect(result.metadata?.kept).toBe('yes');
		expect(result.metadata?.email).not.toBe('a@b.com');
		expect(typeof result.metadata?.email).toBe('string');
	});

	test('passes through an event with no metadata', async () => {
		const redact = createAuditRedactor({ hashFields: ['email'] });
		const event: AuditEvent = { at: 1, type: 'logout' };

		expect((await redact(event)).type).toBe('logout');
	});
});

describe('createSecretCipher', () => {
	test('round-trips encrypt then decrypt', async () => {
		const cipher = createSecretCipher(generateEncryptionKey());
		const ciphertext = await cipher.encrypt('refresh-token-value');

		expect(ciphertext).not.toBe('refresh-token-value');
		expect(await cipher.decrypt(ciphertext)).toBe('refresh-token-value');
	});
});
