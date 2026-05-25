import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { stepUpPlugin } from '../src/routes/stepUp';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { TEST_SESSION_ID } from './setup';

type TestUser = {
	email: string;
	sub: string;
};

const HOUR_MS = 3_600_000;
const FIVE_MINUTES_MS = 300_000;
const TEN_MINUTES_MS = 600_000;

const buildApp = () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const app = new Elysia()
		.use(stepUpPlugin({ authSessionStore }))
		.get('/sensitive', ({ requireRecentAuth }) =>
			requireRecentAuth(FIVE_MINUTES_MS, (user) => ({ user }))
		);

	return { app, authSessionStore };
};

const getSensitive = (
	app: { handle: (request: Request) => Promise<Response> },
	cookie?: string
) =>
	app.handle(
		new Request('http://localhost/sensitive', {
			headers: cookie === undefined ? {} : { cookie }
		})
	);

describe('requireRecentAuth', () => {
	test('allows a freshly authenticated session', async () => {
		const { app, authSessionStore } = buildApp();
		await authSessionStore.setSession(TEST_SESSION_ID, {
			authenticatedAt: Date.now(),
			expiresAt: Date.now() + HOUR_MS,
			user: { email: 'a@b.com', sub: 'user-1' }
		});

		const response = await getSensitive(
			app,
			`user_session_id=${TEST_SESSION_ID}`
		);

		expect(response.status).toBe(200);
	});

	test('blocks a session authenticated outside the window', async () => {
		const { app, authSessionStore } = buildApp();
		await authSessionStore.setSession(TEST_SESSION_ID, {
			authenticatedAt: Date.now() - TEN_MINUTES_MS,
			expiresAt: Date.now() + HOUR_MS,
			user: { email: 'a@b.com', sub: 'user-1' }
		});

		const response = await getSensitive(
			app,
			`user_session_id=${TEST_SESSION_ID}`
		);

		expect(response.status).toBe(401);
	});

	test('blocks when there is no session', async () => {
		const { app } = buildApp();

		expect((await getSensitive(app)).status).toBe(401);
	});
});
