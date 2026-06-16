import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type {
	CredentialEmailMessage,
	CredentialsConfig
} from '../src/credentials/config';
import { credentialsLogin } from '../src/credentials/login';
import { credentialsRegister } from '../src/credentials/register';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { resolveCookieSecure } from '../src/utils';

// Repros issue #6: the `Secure` flag was hardcoded to true on every cookie the package
// set, which broke non-browser HTTP clients (curl, SSR fetch, test runners) trying to
// round-trip a session on http://localhost in dev. The fix: default to NODE_ENV ===
// 'production', and let consumers override via `cookieSecure`.

type TestUser = { email: string; sub: string };

const buildLoginApp = (cookieSecure?: boolean) => {
	const credentialStore = createInMemoryCredentialStore();
	const users = new Map<string, TestUser>();
	const config: CredentialsConfig<TestUser> = {
		credentialStore,
		getUserByEmail: (email) => users.get(email) ?? null,
		onCreateCredentialUser: ({ email }) => {
			const user: TestUser = { email, sub: `user:${email}` };
			users.set(email, user);

			return user;
		},
		onSendEmail: (_message: CredentialEmailMessage) => undefined,
		passwordPolicy: { minLength: 8 }
	};

	return new Elysia()
		.use(credentialsRegister({ ...config, cookieSecure }))
		.use(credentialsLogin({ ...config, cookieSecure }));
};

const registerAndLogin = async (app: {
	handle: (request: Request) => Promise<Response>;
}) => {
	await app.handle(
		new Request('http://localhost/auth/register', {
			body: JSON.stringify({
				email: 'l@example.com',
				password: 'supersecret'
			}),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		})
	);

	return app.handle(
		new Request('http://localhost/auth/login', {
			body: JSON.stringify({
				email: 'l@example.com',
				password: 'supersecret'
			}),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		})
	);
};

describe('resolveCookieSecure', () => {
	const originalNodeEnv = process.env.NODE_ENV;
	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
	});

	test('explicit override wins over NODE_ENV', () => {
		process.env.NODE_ENV = 'production';
		expect(resolveCookieSecure(false)).toBe(false);
		process.env.NODE_ENV = 'development';
		expect(resolveCookieSecure(true)).toBe(true);
	});

	test('defaults to false when NODE_ENV !== production', () => {
		process.env.NODE_ENV = 'development';
		expect(resolveCookieSecure()).toBe(false);
		process.env.NODE_ENV = 'test';
		expect(resolveCookieSecure()).toBe(false);
		delete process.env.NODE_ENV;
		expect(resolveCookieSecure()).toBe(false);
	});

	test('defaults to true when NODE_ENV === production', () => {
		process.env.NODE_ENV = 'production';
		expect(resolveCookieSecure()).toBe(true);
	});
});

describe('credential login cookie Secure flag (issue #6)', () => {
	const originalNodeEnv = process.env.NODE_ENV;
	beforeEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
	});

	test('omits Secure on a dev login so curl/SSR/test-runners can round-trip', async () => {
		process.env.NODE_ENV = 'development';
		const response = await registerAndLogin(buildLoginApp());

		const setCookie = response.headers.get('set-cookie') ?? '';
		expect(setCookie).toContain('user_session_id');
		expect(setCookie).not.toContain('Secure');
		expect(setCookie).toContain('HttpOnly');
	});

	test('sets Secure on a prod login (NODE_ENV=production default)', async () => {
		process.env.NODE_ENV = 'production';
		const response = await registerAndLogin(buildLoginApp());

		const setCookie = response.headers.get('set-cookie') ?? '';
		expect(setCookie).toContain('user_session_id');
		expect(setCookie).toContain('Secure');
	});

	test('honors an explicit `cookieSecure: true` even in dev', async () => {
		process.env.NODE_ENV = 'development';
		const response = await registerAndLogin(buildLoginApp(true));

		const setCookie = response.headers.get('set-cookie') ?? '';
		expect(setCookie).toContain('user_session_id');
		expect(setCookie).toContain('Secure');
	});

	test('honors an explicit `cookieSecure: false` even in prod', async () => {
		process.env.NODE_ENV = 'production';
		const response = await registerAndLogin(buildLoginApp(false));

		const setCookie = response.headers.get('set-cookie') ?? '';
		expect(setCookie).toContain('user_session_id');
		expect(setCookie).not.toContain('Secure');
	});
});
