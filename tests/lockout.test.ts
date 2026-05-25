import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { auth } from '../src/index';
import { createLockoutGuard } from '../src/lockout/config';
import { createInMemoryLockoutStore } from '../src/lockout/inMemoryLockoutStore';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

type TestUser = {
	email: string;
	sub: string;
};

const MINUTE_MS = 60_000;
const MAX_ATTEMPTS = 3;

describe('lockout guard', () => {
	test('locks after the threshold and resets on success', async () => {
		const guard = createLockoutGuard({
			lockoutMs: MINUTE_MS,
			lockoutStore: createInMemoryLockoutStore(),
			maxAttempts: MAX_ATTEMPTS,
			windowMs: MINUTE_MS
		});

		expect((await guard.check('a@b.com')).locked).toBe(false);
		await guard.recordFailure('a@b.com');
		await guard.recordFailure('a@b.com');
		expect((await guard.check('a@b.com')).locked).toBe(false);

		await guard.recordFailure('a@b.com');
		expect((await guard.check('a@b.com')).locked).toBe(true);

		await guard.recordSuccess('a@b.com');
		expect((await guard.check('a@b.com')).locked).toBe(false);
	});
});

describe('login lockout integration', () => {
	test('returns 429 once the account is locked', async () => {
		const credentialStore = createInMemoryCredentialStore();
		const users = new Map<string, TestUser>();
		const authInstance = await auth<TestUser>({
			authSessionStore: createInMemoryAuthSessionStore<TestUser>(),
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
			lockout: {
				lockoutStore: createInMemoryLockoutStore(),
				maxAttempts: MAX_ATTEMPTS
			},
			providersConfiguration: {}
		});
		const app = new Elysia().use(authInstance);
		const post = (path: string, body: unknown) =>
			app.handle(
				new Request(`http://localhost${path}`, {
					body: JSON.stringify(body),
					headers: { 'content-type': 'application/json' },
					method: 'POST'
				})
			);

		await post('/auth/register', {
			email: 'lock@example.com',
			password: 'supersecret'
		});
		const wrong: { email: string; password: string } = {
			email: 'lock@example.com',
			password: 'wrongpass'
		};
		expect((await post('/auth/login', wrong)).status).toBe(401);
		expect((await post('/auth/login', wrong)).status).toBe(401);
		expect((await post('/auth/login', wrong)).status).toBe(401);

		const locked = await post('/auth/login', {
			email: 'lock@example.com',
			password: 'supersecret'
		});
		expect(locked.status).toBe(429);
	});
});
