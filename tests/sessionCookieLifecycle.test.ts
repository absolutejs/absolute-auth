import { describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import { userSessionIdTypebox } from '../src/typebox';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { createInMemoryMfaStore } from '../src/mfa/inMemoryMfaStore';
import { mfaChallenge } from '../src/mfa/challenge';
import { userStatus } from '../src/routes/userStatus';
import { protectRoutePlugin } from '../src/routes/protectRoute';
import { requireAuthPlugin } from '../src/routes/requireAuth';
import { signout } from '../src/routes/signout';
import { generateTotp, generateTotpSecret } from '../src/crypto';
import { getStatus } from '../src/utils';
import {
	TEST_SESSION_ID,
	createTestSessionData,
	createTestUser
} from './setup';

const OK = 200;
const UNAUTHORIZED = 401;
const SESSION_TTL_MS = 60_000;

const fixture = async () => {
	const user = createTestUser();
	const sessions = createInMemoryAuthSessionStore<typeof user>();
	const mfaStore = createInMemoryMfaStore();
	const secret = generateTotpSecret();
	await sessions.setUnregisteredSession(TEST_SESSION_ID, {
		expiresAt: Date.now() + SESSION_TTL_MS,
		userIdentity: { email: user.email }
	});
	await mfaStore.saveEnrollment({
		backupCodeHashes: [],
		createdAt: Date.now(),
		smsVerified: false,
		totpSecretCiphertext: secret,
		totpVerified: true,
		updatedAt: Date.now(),
		userId: user.sub
	});
	const app = new Elysia()
		.use(protectRoutePlugin({ authSessionStore: sessions }))
		.use(
			userStatus({
				authSessionStore: sessions,
				onStatus: () => undefined
			})
		)
		.use(
			mfaChallenge({
				authSessionStore: sessions,
				mfaStore,
				getChallengeUser: () => user,
				getUserId: (value) => value.sub
			})
		)
		.use(
			signout({ authSessionStore: sessions, onSignOut: () => undefined })
		)
		.get('/private', ({ protectRoute }) =>
			protectRoute((value) => ({ user: value }))
		);
	let cookie = `user_session_id=${TEST_SESSION_ID}`;
	const request = async (path: string, method = 'GET', body?: unknown) => {
		const response = await app.handle(
			new Request(`http://localhost${path}`, {
				body: body === undefined ? undefined : JSON.stringify(body),
				headers: { 'content-type': 'application/json', cookie },
				method
			})
		);
		// Model browser behavior: every response can overwrite the cookie shared by tabs.
		const next = response.headers
			.getSetCookie()
			.find((value) => value.startsWith('user_session_id='));
		if (next)
			cookie = next.includes('Max-Age=0')
				? ''
				: (next.split(';')[0] ?? '');

		return response;
	};

	return { request, secret, sessions, user };
};

describe('session cookies during MFA and background requests', () => {
	test('method discovery, background status, protected calls and rejected codes preserve the MFA cookie', async () => {
		const { request, sessions, secret } = await fixture();
		expect((await request('/auth/mfa/challenge')).status).toBe(OK);
		const status = await request('/oauth2/status');
		expect(await status.json()).toMatchObject({ user: null });
		expect(status.headers.get('set-cookie')).toBeNull();
		const denied = await request('/private');
		expect(denied.status).toBe(UNAUTHORIZED);
		expect(denied.headers.get('set-cookie')).toBeNull();
		const invalid = await request('/auth/mfa/challenge', 'POST', {
			code: 'invalid',
			factor: 'totp'
		});
		expect(invalid.status).toBe(UNAUTHORIZED);
		expect(invalid.headers.get('set-cookie')).toBeNull();
		expect(
			await sessions.getUnregisteredSession(TEST_SESSION_ID)
		).toBeDefined();
		const verified = await request('/auth/mfa/challenge', 'POST', {
			code: await generateTotp({ secret }),
			factor: 'totp'
		});
		expect(verified.status).toBe(OK);
		expect(await verified.json()).toMatchObject({
			status: 'authenticated'
		});
		expect(
			await sessions.getUnregisteredSession(TEST_SESSION_ID)
		).toBeUndefined();
		expect((await request('/private')).status).toBe(OK);
		await request('/oauth2/signout', 'DELETE');
		expect((await request('/private')).status).toBe(UNAUTHORIZED);
	});
	test('requireAuth rejects pending sessions without deleting the shared cookie', async () => {
		const { sessions } = await fixture();
		const app = new Elysia()
			.use(requireAuthPlugin({ authSessionStore: sessions }))
			.get('/private', () => 'secret');
		const response = await app.handle(
			new Request('http://localhost/private', {
				headers: { cookie: `user_session_id=${TEST_SESSION_ID}` }
			})
		);
		expect(response.status).toBe(UNAUTHORIZED);
		expect(response.headers.get('set-cookie')).toBeNull();
	});
	test('late missing-session responses cannot erase a newly issued cookie', async () => {
		const loaded = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const sessions = createInMemoryAuthSessionStore();
		const source = {
			...sessions,
			getSession: async () => {
				loaded.resolve();
				await release.promise;

				return undefined;
			}
		};
		const app = new Elysia().use(
			userStatus({ authSessionStore: source, onStatus: () => undefined })
		);
		const response = app.handle(
			new Request('http://localhost/oauth2/status', {
				headers: { cookie: `user_session_id=${TEST_SESSION_ID}` }
			})
		);
		await loaded.promise;
		// A login in another request can set a new browser cookie before this response arrives.
		release.resolve();
		const completed = await response;
		expect(completed.status).toBe(OK);
		expect(completed.headers.get('set-cookie')).toBeNull();
	});
	test('expired durable sessions are rejected and deleted without a cookie mutation', async () => {
		const sessions = createInMemoryAuthSessionStore();
		await sessions.setSession(
			TEST_SESSION_ID,
			createTestSessionData({ expiresAt: Date.now() - 1 })
		);
		const app = new Elysia().use(
			userStatus({
				authSessionStore: sessions,
				onStatus: () => undefined
			})
		);
		const response = await app.handle(
			new Request('http://localhost/oauth2/status', {
				headers: { cookie: `user_session_id=${TEST_SESSION_ID}` }
			})
		);
		expect((await response.json()).user).toBeNull();
		expect(await sessions.getSession(TEST_SESSION_ID)).toBeUndefined();
		expect(response.headers.get('set-cookie')).toBeNull();
	});
	test('legacy in-memory status follows the same non-mutating cookie rule', async () => {
		const sessions = {
			[TEST_SESSION_ID]: createTestSessionData({
				expiresAt: Date.now() - 1
			})
		};
		const app = new Elysia().get(
			'/status',
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) },
			({ cookie: { user_session_id } }) =>
				getStatus(sessions, user_session_id)
		);
		const response = await app.handle(
			new Request('http://localhost/status', {
				headers: { cookie: `user_session_id=${TEST_SESSION_ID}` }
			})
		);
		expect((await response.json()).user).toBeNull();
		expect(sessions[TEST_SESSION_ID]).toBeUndefined();
		expect(response.headers.get('set-cookie')).toBeNull();
	});
});
