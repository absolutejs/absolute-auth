import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { CredentialsConfig } from '../src/credentials/config';
import { credentialsLogin } from '../src/credentials/login';
import { credentialsRegister } from '../src/credentials/register';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { requireAuthPlugin } from '../src/routes/requireAuth';

type TestUser = { email: string; sub: string };

// A route defined AFTER `.use(requireAuthPlugin())` must be guarded by mounting
// alone — the handler has no per-route auth check, which is exactly the case
// protectRoutePlugin would leave public.
const buildApp = () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const users = new Map<string, TestUser>();
	const config: CredentialsConfig<TestUser> = {
		credentialStore: createInMemoryCredentialStore(),
		passwordPolicy: { minLength: 8 },
		getUserByEmail: (email) => users.get(email) ?? null,
		onCreateCredentialUser: ({ email }) => {
			const user = { email, sub: `user:${email}` };
			users.set(email, user);

			return user;
		},
		onSendEmail: () => undefined
	};

	return new Elysia()
		.use(credentialsRegister({ ...config, authSessionStore }))
		.use(credentialsLogin({ ...config, authSessionStore }))
		.use(requireAuthPlugin<TestUser>({ authSessionStore }))
		.get('/secret', ({ user }) => ({ ok: true, sub: user?.sub ?? null }));
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

const sessionCookie = (response: Response) =>
	response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('user_session_id='))
		?.split(';')[0] ?? '';

describe('requireAuthPlugin fails closed by default (F7)', () => {
	test('an unguarded handler mounted under it rejects an anonymous request', async () => {
		const app = buildApp();
		const res = await app.handle(new Request('http://localhost/secret'));
		expect(res.status).not.toBe(200);
		expect(res.status).toBe(401);
	});

	test('a well-formed but unknown session cookie is rejected', async () => {
		const app = buildApp();
		const res = await app.handle(
			new Request('http://localhost/secret', {
				headers: {
					cookie: 'user_session_id=00000000-0000-0000-0000-000000000000'
				}
			})
		);
		expect(res.status).not.toBe(200);
	});

	test('an authenticated request passes and exposes ctx.user', async () => {
		const app = buildApp();
		await post(app, '/auth/register', {
			email: 'a@b.com',
			password: 'password123'
		});
		const login = await post(app, '/auth/login', {
			email: 'a@b.com',
			password: 'password123'
		});
		const cookie = sessionCookie(login);
		expect(cookie).toContain('user_session_id=');

		const res = await app.handle(
			new Request('http://localhost/secret', { headers: { cookie } })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			ok: true,
			sub: 'user:a@b.com'
		});
	});
});
