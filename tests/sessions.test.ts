import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { auth } from '../src/index';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import {
	refreshUserSessions,
	revokeUserSessions
} from '../src/session/userSessions';

type TestUser = {
	email: string;
	roles?: string[];
	sub: string;
};

const HOUR_MS = 3_600_000;
const ID_ONE = '111e4567-e89b-42d3-a456-426614174001';
const ID_TWO = '222e4567-e89b-42d3-a456-426614174002';
const ID_THREE = '333e4567-e89b-42d3-a456-426614174003';

const buildApp = async () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const credentialStore = createInMemoryCredentialStore();
	const users = new Map<string, TestUser>();
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
			onSendEmail: () => undefined
		},
		providersConfiguration: {},
		sessions: { getUserId: (user) => user.sub }
	});

	return new Elysia().use(authInstance);
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

describe('revokeUserSessions', () => {
	test('removes the user’s sessions except the excepted one', async () => {
		const store = createInMemoryAuthSessionStore<TestUser>();
		const session = (sub: string) => ({
			authenticatedAt: Date.now(),
			expiresAt: Date.now() + HOUR_MS,
			user: { email: `${sub}@b.com`, sub }
		});
		await store.setSession(ID_ONE, session('u1'));
		await store.setSession(ID_TWO, session('u1'));
		await store.setSession(ID_THREE, session('u2'));

		const removed = await revokeUserSessions({
			authSessionStore: store,
			exceptSessionId: ID_ONE,
			userId: 'u1',
			getUserId: (user) => user.sub
		});

		expect(removed).toBe(1);
		expect(await store.getSession(ID_ONE)).toBeDefined();
		expect(await store.getSession(ID_TWO)).toBeUndefined();
		expect(await store.getSession(ID_THREE)).toBeDefined();
	});
});

describe('refreshUserSessions', () => {
	test('rewrites the user snapshot on every session for that user', async () => {
		const store = createInMemoryAuthSessionStore<TestUser>();
		const expiresAt = Date.now() + HOUR_MS;
		const authenticatedAt = Date.now();
		const session = (sub: string) => ({
			authenticatedAt,
			expiresAt,
			user: { email: `${sub}@b.com`, roles: [], sub }
		});
		await store.setSession(ID_ONE, session('u1'));
		await store.setSession(ID_TWO, session('u1'));
		await store.setSession(ID_THREE, session('u2'));

		const updated = await refreshUserSessions({
			authSessionStore: store,
			user: { email: 'u1@b.com', roles: ['admin'], sub: 'u1' },
			userId: 'u1',
			getUserId: (user) => user.sub
		});

		expect(updated).toBe(2);
		expect((await store.getSession(ID_ONE))?.user.roles).toEqual(['admin']);
		expect((await store.getSession(ID_TWO))?.user.roles).toEqual(['admin']);
		// other session fields survive the rewrite
		expect((await store.getSession(ID_ONE))?.expiresAt).toBe(expiresAt);
		expect((await store.getSession(ID_ONE))?.authenticatedAt).toBe(
			authenticatedAt
		);
		// other users are untouched
		expect((await store.getSession(ID_THREE))?.user.roles).toEqual([]);
	});
});

describe('session management routes', () => {
	test('lists the caller’s sessions and revokes a chosen one', async () => {
		const app = await buildApp();
		const credentials: { email: string; password: string } = {
			email: 'sess@example.com',
			password: 'supersecret'
		};

		const registered = await post(app, '/auth/register', credentials);
		const firstCookie = cookieFrom(registered);
		const firstId = firstCookie.slice('user_session_id='.length);

		const loggedIn = await post(app, '/auth/login', credentials);
		const secondCookie = cookieFrom(loggedIn);

		const listed = await send(app, '/auth/sessions', 'GET', secondCookie);
		expect(listed.status).toBe(200);
		expect((await listed.json()).sessions).toHaveLength(2);

		const revoked = await send(
			app,
			`/auth/sessions/${firstId}`,
			'DELETE',
			secondCookie
		);
		expect(revoked.status).toBe(200);

		const after = await send(app, '/auth/sessions', 'GET', secondCookie);
		expect((await after.json()).sessions).toHaveLength(1);
	});
});
