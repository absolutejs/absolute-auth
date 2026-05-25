import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { protectPermissionPlugin } from '../src/authorization/protectPermission';
import type { AuditEvent } from '../src/audit/types';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { TEST_SESSION_ID } from './setup';

type TestUser = {
	email: string;
	role: string;
	sub: string;
};

const HOUR_MS = 3_600_000;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

const seededUser: TestUser = {
	email: 'a@b.com',
	role: 'admin',
	sub: 'user-1'
};

const buildApp = (
	hasPermission: (context: { permission: string; user: TestUser }) => boolean,
	events: AuditEvent[] = []
) => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const app = new Elysia()
		.use(
			protectPermissionPlugin<TestUser>({
				authSessionStore,
				hasPermission,
				emit: async (event) => {
					events.push(event);
				}
			})
		)
		.get('/billing', ({ protectPermission }) =>
			protectPermission({ permission: 'billing:read' }, (user) => ({
				ok: user.sub
			}))
		);

	return { app, authSessionStore };
};

const callBilling = (
	app: { handle: (request: Request) => Promise<Response> },
	cookie?: string
) =>
	app.handle(
		new Request('http://localhost/billing', {
			headers: cookie === undefined ? {} : { cookie }
		})
	);

describe('protectPermission', () => {
	test('runs the handler when the consumer grants the permission', async () => {
		const { app, authSessionStore } = buildApp(() => true);
		await authSessionStore.setSession(TEST_SESSION_ID, {
			authenticatedAt: Date.now(),
			expiresAt: Date.now() + HOUR_MS,
			user: seededUser
		});

		const response = await callBilling(
			app,
			`user_session_id=${TEST_SESSION_ID}`
		);

		expect(response.status).toBe(HTTP_OK);
		expect((await response.json()).ok).toBe('user-1');
	});

	test('returns 403 and audits when the consumer denies the permission', async () => {
		const events: AuditEvent[] = [];
		const { app, authSessionStore } = buildApp(() => false, events);
		await authSessionStore.setSession(TEST_SESSION_ID, {
			authenticatedAt: Date.now(),
			expiresAt: Date.now() + HOUR_MS,
			user: seededUser
		});

		const response = await callBilling(
			app,
			`user_session_id=${TEST_SESSION_ID}`
		);

		expect(response.status).toBe(HTTP_FORBIDDEN);
		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe('authorization_denied');
		expect(events[0]?.metadata?.permission).toBe('billing:read');
	});

	test('returns 401 when there is no session', async () => {
		const { app } = buildApp(() => true);

		expect((await callBilling(app)).status).toBe(HTTP_UNAUTHORIZED);
	});

	test('passes the permission and user to the consumer hook', async () => {
		let seen: { permission: string; user: TestUser } | undefined;
		const { app, authSessionStore } = buildApp((context) => {
			seen = context;

			return context.user.role === 'admin';
		});
		await authSessionStore.setSession(TEST_SESSION_ID, {
			authenticatedAt: Date.now(),
			expiresAt: Date.now() + HOUR_MS,
			user: seededUser
		});

		await callBilling(app, `user_session_id=${TEST_SESSION_ID}`);

		expect(seen?.permission).toBe('billing:read');
		expect(seen?.user.sub).toBe('user-1');
	});
});
