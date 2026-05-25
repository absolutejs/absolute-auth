import { beforeEach, describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import { loadSessionFromSource } from '../src/session/access';
import {
	endImpersonation,
	isImpersonating,
	startImpersonation
} from '../src/session/impersonation';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { promoteToSession } from '../src/session/promote';
import { sessionStore } from '../src/session/state';
import { userSessionIdTypebox } from '../src/typebox';

type TestUser = { email: string; sub: string };

const HOUR_MS = 3_600_000;
const admin: TestUser = { email: 'admin@acme.test', sub: 'admin-1' };
const target: TestUser = { email: 'alice@acme.test', sub: 'user-alice' };

const cookieSchema = {
	cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
};

const buildApp = () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();

	return new Elysia()
		.use(sessionStore<TestUser>())
		.post(
			'/login-admin',
			async ({ cookie: { user_session_id }, store: { session } }) => {
				await promoteToSession({
					authSessionStore,
					cookie: user_session_id,
					inMemorySession: session,
					sessionDurationMs: HOUR_MS,
					user: admin
				});

				return { ok: true };
			},
			cookieSchema
		)
		.post(
			'/impersonate',
			async ({ cookie: { user_session_id }, store: { session } }) => {
				await startImpersonation({
					authSessionStore,
					cookie: user_session_id,
					getUserId: (user) => user.sub,
					impersonator: {
						actorId: admin.sub,
						reason: 'support ticket #42'
					},
					inMemorySession: session,
					sessionDurationMs: HOUR_MS,
					user: target
				});

				return { ok: true };
			},
			cookieSchema
		)
		.get(
			'/whoami',
			async ({ cookie: { user_session_id }, store: { session } }) => {
				const current = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});

				return {
					actorId: current?.impersonator?.actorId ?? null,
					email: current?.user.email ?? null,
					impersonating: isImpersonating(current)
				};
			},
			cookieSchema
		)
		.post(
			'/end',
			async ({ cookie: { user_session_id }, store: { session } }) =>
				endImpersonation({
					authSessionStore,
					cookie: user_session_id,
					inMemorySession: session
				}),
			cookieSchema
		);
};

const cookieFrom = (response: Response) =>
	response.headers
		.getSetCookie()
		.find((entry) => entry.startsWith('user_session_id='))
		?.split(';')[0] ?? '';

const send = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	method: string,
	cookie: string
) =>
	app.handle(
		new Request(`http://localhost${path}`, { headers: { cookie }, method })
	);

describe('admin impersonation', () => {
	let app = buildApp();

	beforeEach(() => {
		app = buildApp();
	});

	test('impersonating swaps to the target, flagged with the impersonator', async () => {
		const login = await send(app, '/login-admin', 'POST', '');
		const adminCookie = cookieFrom(login);

		const asAdmin = await (
			await send(app, '/whoami', 'GET', adminCookie)
		).json();
		expect(asAdmin).toEqual({
			actorId: null,
			email: admin.email,
			impersonating: false
		});

		const impersonate = await send(
			app,
			'/impersonate',
			'POST',
			adminCookie
		);
		const imperCookie = cookieFrom(impersonate);
		expect(imperCookie).not.toBe(adminCookie);

		const asTarget = await (
			await send(app, '/whoami', 'GET', imperCookie)
		).json();
		expect(asTarget).toEqual({
			actorId: admin.sub,
			email: target.email,
			impersonating: true
		});
	});

	test('ending impersonation restores the original admin session', async () => {
		const login = await send(app, '/login-admin', 'POST', '');
		const adminCookie = cookieFrom(login);
		const impersonate = await send(
			app,
			'/impersonate',
			'POST',
			adminCookie
		);
		const imperCookie = cookieFrom(impersonate);

		const ended = await send(app, '/end', 'POST', imperCookie);
		const endedBody = await ended.json();
		expect(endedBody).toEqual({ restored: true });

		const restoredCookie = cookieFrom(ended);
		const back = await (
			await send(app, '/whoami', 'GET', restoredCookie)
		).json();
		expect(back).toEqual({
			actorId: null,
			email: admin.email,
			impersonating: false
		});
	});
});
