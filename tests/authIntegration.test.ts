import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { CredentialEmailMessage } from '../src/credentials/config';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { auth } from '../src/index';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

type TestUser = {
	email: string;
	sub: string;
};

const buildAuthApp = async () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const credentialStore = createInMemoryCredentialStore();
	const users = new Map<string, TestUser>();
	const sent: CredentialEmailMessage[] = [];

	const authInstance = await auth<TestUser>({
		authSessionStore,
		credentials: {
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
			}
		},
		providersConfiguration: {}
	});

	const app = new Elysia()
		.use(authInstance)
		.get('/me', ({ protectRoute }) => protectRoute((user) => ({ user })));

	return { app, sent };
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

describe('auth() credentials integration', () => {
	test('register → verify → login → protected route, all via auth()', async () => {
		const { app, sent } = await buildAuthApp();

		const registered = await post(app, '/auth/register', {
			email: 'flow@example.com',
			password: 'supersecret'
		});
		expect(registered.status).toBe(201);

		const verifyToken =
			sent.find((message) => message.type === 'verify_email')?.token ?? '';
		const verified = await post(app, '/auth/verify-email', {
			token: verifyToken
		});
		expect(verified.status).toBe(200);

		const loggedIn = await post(app, '/auth/login', {
			email: 'flow@example.com',
			password: 'supersecret'
		});
		expect(loggedIn.status).toBe(200);

		const sessionCookie = loggedIn.headers
			.getSetCookie()
			.find((cookie) => cookie.startsWith('user_session_id='));
		const cookieHeader = sessionCookie?.split(';')[0] ?? '';
		expect(cookieHeader).toContain('user_session_id=');

		// The credential session must be transparent to protectRoute.
		const authed = await app.handle(
			new Request('http://localhost/me', {
				headers: { cookie: cookieHeader }
			})
		);
		expect(authed.status).toBe(200);
		expect(await authed.json()).toMatchObject({
			user: { email: 'flow@example.com' }
		});

		const anonymous = await app.handle(
			new Request('http://localhost/me')
		);
		expect(anonymous.status).toBe(401);
	});
});
