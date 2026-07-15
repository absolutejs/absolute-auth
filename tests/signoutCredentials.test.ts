import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { CredentialsConfig } from '../src/credentials/config';
import { credentialsLogin } from '../src/credentials/login';
import { credentialsRegister } from '../src/credentials/register';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { signout } from '../src/routes/signout';
import type { AuthSessionStore } from '../src/session/types';

// Repros issue #7: `DELETE /oauth2/signout` 401'd on credentials sessions because the
// handler hard-failed when the `auth_provider` cookie was missing. But `auth_provider`
// is only set during the OAuth2 `/authorize` flow — credentials, MFA, passwordless,
// SSO, WebAuthn, and impersonation-minted sessions never have one. So the only signout
// route in the package couldn't sign out any non-OAuth session. Fix: drop the hard-fail,
// widen OnSignOut.authProvider to `string | undefined`, keep clearing both cookies.

type TestUser = { email: string; sub: string };

const buildApp = (
	onSignOut?: (context: {
		authProvider: string | undefined;
		userSessionId: string;
	}) => void
) => {
	const credentialStore = createInMemoryCredentialStore();
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
		onSendEmail: () => undefined
	};

	return new Elysia()
		.use(credentialsRegister(config))
		.use(credentialsLogin(config))
		.use(
			signout<TestUser>({
				onSignOut: onSignOut
					? ({ authProvider, userSessionId }) =>
							onSignOut({ authProvider, userSessionId })
					: undefined
			})
		);
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

const sessionCookieFrom = (response: Response) => {
	const setCookie = response.headers.get('set-cookie') ?? '';
	const match = setCookie.match(/user_session_id=([^;]+)/);
	if (match === null || match[1] === undefined) {
		throw new Error('no user_session_id in set-cookie');
	}

	return `user_session_id=${match[1]}`;
};

describe('credentials signout (issue #7)', () => {
	test('removes registered and unregistered records without redundant store calls', async () => {
		const sessionId = '111e4567-e89b-42d3-a456-426614174001';
		const calls = {
			get: 0,
			getUnregistered: 0,
			remove: 0,
			removeUnregistered: 0
		};
		const store: AuthSessionStore<TestUser> = {
			getSession: async () => {
				calls.get += 1;

				return {
					expiresAt: Date.now() + 60_000,
					user: { email: 'a@b.com', sub: 'user:a@b.com' }
				};
			},
			getUnregisteredSession: async () => {
				calls.getUnregistered += 1;

				return undefined;
			},
			removeSession: async () => {
				calls.remove += 1;
			},
			removeUnregisteredSession: async () => {
				calls.removeUnregistered += 1;
			},
			setSession: async () => undefined,
			setUnregisteredSession: async () => undefined
		};
		const app = new Elysia().use(
			signout({ authSessionStore: store, onSignOut: undefined })
		);
		const response = await app.handle(
			new Request('http://localhost/oauth2/signout', {
				headers: { cookie: `user_session_id=${sessionId}` },
				method: 'DELETE'
			})
		);

		expect(response.status).toBe(204);
		expect(calls).toEqual({
			get: 1,
			getUnregistered: 0,
			remove: 1,
			removeUnregistered: 1
		});
	});

	test('signs out a credentials session even without auth_provider cookie', async () => {
		const app = buildApp();
		await postJson(app, '/auth/register', {
			email: 'a@b.com',
			password: 'supersecret'
		});
		const loginResponse = await postJson(app, '/auth/login', {
			email: 'a@b.com',
			password: 'supersecret'
		});
		expect(loginResponse.status).toBe(200);

		const cookie = sessionCookieFrom(loginResponse);
		const signoutResponse = await app.handle(
			new Request('http://localhost/oauth2/signout', {
				headers: { cookie },
				method: 'DELETE'
			})
		);

		// Pre-fix: 401 "No auth provider found". Post-fix: 204 No Content.
		expect(signoutResponse.status).toBe(204);
		const clearedCookie = signoutResponse.headers.get('set-cookie') ?? '';
		expect(clearedCookie).toContain('user_session_id');
	});

	test('passes authProvider: undefined to onSignOut for credentials sessions', async () => {
		const seen: Array<{
			authProvider: string | undefined;
			userSessionId: string;
		}> = [];
		const app = buildApp((context) => seen.push(context));

		await postJson(app, '/auth/register', {
			email: 'a@b.com',
			password: 'supersecret'
		});
		const loginResponse = await postJson(app, '/auth/login', {
			email: 'a@b.com',
			password: 'supersecret'
		});
		const cookie = sessionCookieFrom(loginResponse);

		await app.handle(
			new Request('http://localhost/oauth2/signout', {
				headers: { cookie },
				method: 'DELETE'
			})
		);

		expect(seen).toHaveLength(1);
		expect(seen[0]?.authProvider).toBeUndefined();
		expect(seen[0]?.userSessionId).toBeDefined();
	});

	test('still rejects requests with no session cookie at all', async () => {
		const app = buildApp();
		const response = await app.handle(
			new Request('http://localhost/oauth2/signout', { method: 'DELETE' })
		);
		expect(response.status).toBe(401);
	});

	test('still passes through authProvider when the cookie IS set (OAuth flow)', async () => {
		const seen: Array<{
			authProvider: string | undefined;
			userSessionId: string;
		}> = [];
		const app = buildApp((context) => seen.push(context));

		await postJson(app, '/auth/register', {
			email: 'a@b.com',
			password: 'supersecret'
		});
		const loginResponse = await postJson(app, '/auth/login', {
			email: 'a@b.com',
			password: 'supersecret'
		});
		const sessionCookie = sessionCookieFrom(loginResponse);
		// Simulate the OAuth2 /authorize flow having set auth_provider:
		const compositeCookie = `${sessionCookie}; auth_provider=github`;

		await app.handle(
			new Request('http://localhost/oauth2/signout', {
				headers: { cookie: compositeCookie },
				method: 'DELETE'
			})
		);

		expect(seen).toHaveLength(1);
		expect(seen[0]?.authProvider).toBe('github');
	});
});
