import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type {
	CredentialEmailMessage,
	CredentialsConfig
} from '../src/credentials/config';
import { credentialsEmailVerification } from '../src/credentials/emailVerification';
import { credentialsLogin } from '../src/credentials/login';
import { credentialsPasswordReset } from '../src/credentials/passwordReset';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { credentialsRegister } from '../src/credentials/register';

type TestUser = {
	email: string;
	sub: string;
};

const buildHarness = (overrides: Partial<CredentialsConfig<TestUser>> = {}) => {
	const credentialStore = createInMemoryCredentialStore();
	const sent: CredentialEmailMessage[] = [];
	const users = new Map<string, TestUser>();
	const config: CredentialsConfig<TestUser> = {
		credentialStore,
		passwordPolicy: { minLength: 8 },
		getUserByEmail: (email) => users.get(email) ?? null,
		onCreateCredentialUser: ({ email }) => {
			const user: TestUser = { email, sub: `user:${email}` };
			users.set(email, user);

			return user;
		},
		onSendEmail: (message) => {
			sent.push(message);
		},
		...overrides
	};
	const app = new Elysia()
		.use(credentialsRegister(config))
		.use(credentialsEmailVerification(config))
		.use(credentialsLogin(config))
		.use(credentialsPasswordReset(config));

	return { app, credentialStore, sent, users };
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

const registerUser = (
	app: { handle: (request: Request) => Promise<Response> },
	email: string,
	password: string
) => postJson(app, '/auth/register', { email, password });

describe('credential registration + verification flow', () => {
	test('registers, emails a token, and verifies the email', async () => {
		const { app, credentialStore, sent } = buildHarness();

		const registered = await registerUser(
			app,
			'New@Example.com',
			'supersecret'
		);

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

		const weak = await registerUser(app, 'a@b.com', 'short');
		expect(weak.status).toBe(400);

		const first = await registerUser(app, 'dup@b.com', 'supersecret');
		expect(first.status).toBe(201);

		const second = await registerUser(app, 'dup@b.com', 'supersecret');
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

describe('credential login', () => {
	test('authenticates valid credentials and sets a session cookie', async () => {
		const { app } = buildHarness();
		await registerUser(app, 'login@example.com', 'supersecret');

		const response = await postJson(app, '/auth/login', {
			email: 'login@example.com',
			password: 'supersecret'
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie') ?? '').toContain(
			'user_session_id'
		);
	});

	test('rejects an incorrect password', async () => {
		const { app } = buildHarness();
		await registerUser(app, 'login@example.com', 'supersecret');

		const response = await postJson(app, '/auth/login', {
			email: 'login@example.com',
			password: 'wrongpassword'
		});

		expect(response.status).toBe(401);
	});

	test('returns mfa_required when a factor is enrolled', async () => {
		const { app } = buildHarness({ isMfaRequired: () => true });
		await registerUser(app, 'mfa@example.com', 'supersecret');

		const response = await postJson(app, '/auth/login', {
			email: 'mfa@example.com',
			password: 'supersecret'
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ status: 'mfa_required' });
	});
});

describe('password reset flow', () => {
	test('rotates the password and invalidates the old one', async () => {
		const { app, sent } = buildHarness();
		await registerUser(app, 'reset@example.com', 'originalpass');

		const requested = await postJson(app, '/auth/reset-password/request', {
			email: 'reset@example.com'
		});
		expect(requested.status).toBe(200);

		const resetMessage = sent.find(
			(message) => message.type === 'reset_password'
		);
		expect(resetMessage).toBeDefined();

		const confirmed = await postJson(app, '/auth/reset-password', {
			password: 'brandnewpass',
			token: resetMessage?.token ?? ''
		});
		expect(confirmed.status).toBe(200);

		const oldLogin = await postJson(app, '/auth/login', {
			email: 'reset@example.com',
			password: 'originalpass'
		});
		expect(oldLogin.status).toBe(401);

		const newLogin = await postJson(app, '/auth/login', {
			email: 'reset@example.com',
			password: 'brandnewpass'
		});
		expect(newLogin.status).toBe(200);
	});
});

describe('registration session behavior', () => {
	test('auto-logs in on registration by default', async () => {
		const { app } = buildHarness();

		const response = await registerUser(
			app,
			'auto@example.com',
			'supersecret'
		);

		expect(response.status).toBe(201);
		expect(response.headers.get('set-cookie') ?? '').toContain(
			'user_session_id'
		);
	});

	test('requireEmailVerification gates the session until verified', async () => {
		const { app, sent } = buildHarness({ requireEmailVerification: true });

		const registered = await registerUser(
			app,
			'verify-first@example.com',
			'supersecret'
		);
		expect(registered.status).toBe(201);
		expect(registered.headers.get('set-cookie') ?? '').not.toContain(
			'user_session_id'
		);
		expect(await registered.json()).toMatchObject({
			status: 'verification_required'
		});

		const blocked = await postJson(app, '/auth/login', {
			email: 'verify-first@example.com',
			password: 'supersecret'
		});
		expect(blocked.status).toBe(403);

		const token =
			sent.find((message) => message.type === 'verify_email')?.token ??
			'';
		const verified = await postJson(app, '/auth/verify-email', { token });
		expect(verified.status).toBe(200);

		const allowed = await postJson(app, '/auth/login', {
			email: 'verify-first@example.com',
			password: 'supersecret'
		});
		expect(allowed.status).toBe(200);
	});

	test('passes extra signup fields through to onCreateCredentialUser', async () => {
		let captured: Record<string, unknown> | undefined;
		const config: CredentialsConfig<TestUser> = {
			credentialStore: createInMemoryCredentialStore(),
			passwordPolicy: { minLength: 8 },
			getUserByEmail: async () => null,
			onCreateCredentialUser: (identity) => {
				captured = identity;

				return { email: identity.email, sub: 'user:extra' };
			},
			onSendEmail: () => undefined
		};
		const app = new Elysia().use(credentialsRegister(config));

		await postJson(app, '/auth/register', {
			email: 'extra@example.com',
			family_name: 'Lovelace',
			given_name: 'Ada',
			password: 'supersecret'
		});

		expect(captured?.given_name).toBe('Ada');
		expect(captured?.family_name).toBe('Lovelace');
	});
});
