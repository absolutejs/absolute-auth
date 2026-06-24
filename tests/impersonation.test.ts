import { beforeEach, describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import {
	getStatusFromSource,
	loadSessionFromSource
} from '../src/session/access';
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
					impersonator: {
						actorId: admin.sub,
						readOnly: true,
						reason: 'support ticket #42'
					},
					inMemorySession: session,
					sessionDurationMs: HOUR_MS,
					user: target,
					getUserId: (user) => user.sub
				});

				return { ok: true };
			},
			cookieSchema
		)
		.get(
			'/mode',
			async ({ cookie: { user_session_id }, store: { session } }) => {
				const current = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});

				return { readOnly: current?.impersonator?.readOnly ?? null };
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
			'/impersonate-audit-fail',
			async ({ cookie: { user_session_id }, store: { session } }) => {
				try {
					await startImpersonation({
						authSessionStore,
						cookie: user_session_id,
						impersonator: {
							actorId: admin.sub,
							reason: 'support ticket #43'
						},
						inMemorySession: session,
						sessionDurationMs: HOUR_MS,
						user: target,
						emit: () => {
							throw new Error('audit sink down');
						}
					});

					return { threw: false };
				} catch {
					return { threw: true };
				}
			},
			cookieSchema
		)
		.post(
			'/impersonate-nested',
			async ({ cookie: { user_session_id }, store: { session } }) => {
				try {
					await startImpersonation({
						authSessionStore,
						cookie: user_session_id,
						impersonator: {
							actorId: 'user-alice',
							reason: 'chaining'
						},
						inMemorySession: session,
						sessionDurationMs: HOUR_MS,
						user: { email: 'bob@acme.test', sub: 'user-bob' }
					});

					return { threw: false };
				} catch {
					return { threw: true };
				}
			},
			cookieSchema
		)
		.get(
			'/status',
			async ({ cookie: { user_session_id }, store: { session } }) => {
				const { user, impersonator } = await getStatusFromSource({
					authSessionStore,
					session,
					user_session_id
				});

				return {
					actorId: impersonator?.actorId ?? null,
					email: user?.email ?? null
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

	test('readOnly (ghost) flag is stamped on the impersonation session', async () => {
		const login = await send(app, '/login-admin', 'POST', '');
		const adminCookie = cookieFrom(login);
		const impersonate = await send(app, '/impersonate', 'POST', adminCookie);
		const imperCookie = cookieFrom(impersonate);

		const mode = await (
			await send(app, '/mode', 'GET', imperCookie)
		).json();
		expect(mode).toEqual({ readOnly: true });
	});

	test('getStatusFromSource surfaces the impersonator (banner data)', async () => {
		const login = await send(app, '/login-admin', 'POST', '');
		const adminCookie = cookieFrom(login);

		// A normal admin session reports no impersonator.
		const adminStatus = await (
			await send(app, '/status', 'GET', adminCookie)
		).json();
		expect(adminStatus).toEqual({ actorId: null, email: admin.email });

		const impersonate = await send(app, '/impersonate', 'POST', adminCookie);
		const imperCookie = cookieFrom(impersonate);
		const imperStatus = await (
			await send(app, '/status', 'GET', imperCookie)
		).json();
		expect(imperStatus).toEqual({
			actorId: admin.sub,
			email: target.email
		});
	});

	test('a failed audit write rolls back the impersonation session and restores the admin', async () => {
		const login = await send(app, '/login-admin', 'POST', '');
		const adminCookie = cookieFrom(login);

		const attempt = await send(
			app,
			'/impersonate-audit-fail',
			'POST',
			adminCookie
		);
		expect(await attempt.json()).toEqual({ threw: true });

		// The cookie must be restored to the admin's own session, not a dangling
		// impersonation session that outlived its missing audit record.
		const restoredCookie = cookieFrom(attempt);
		expect(restoredCookie).toBe(adminCookie);

		const whoami = await (
			await send(app, '/whoami', 'GET', restoredCookie)
		).json();
		expect(whoami).toEqual({
			actorId: null,
			email: admin.email,
			impersonating: false
		});
	});

	test('nested impersonation is refused by default', async () => {
		const login = await send(app, '/login-admin', 'POST', '');
		const adminCookie = cookieFrom(login);
		const impersonate = await send(app, '/impersonate', 'POST', adminCookie);
		const imperCookie = cookieFrom(impersonate);

		const nested = await send(
			app,
			'/impersonate-nested',
			'POST',
			imperCookie
		);
		expect(await nested.json()).toEqual({ threw: true });

		// The original impersonation session is untouched — still acting as the first target,
		// with the original actor stamp (no overwrite, no chain).
		const stillFirst = await (
			await send(app, '/whoami', 'GET', imperCookie)
		).json();
		expect(stillFirst).toEqual({
			actorId: admin.sub,
			email: target.email,
			impersonating: true
		});
	});

	test('ending impersonation on a normal session is a no-op (does not log out)', async () => {
		const login = await send(app, '/login-admin', 'POST', '');
		const adminCookie = cookieFrom(login);

		const ended = await send(app, '/end', 'POST', adminCookie);
		expect(await ended.json()).toEqual({ restored: false });

		// The admin session must survive — a stray "end" must never destroy a real session.
		const whoami = await (
			await send(app, '/whoami', 'GET', adminCookie)
		).json();
		expect(whoami).toEqual({
			actorId: null,
			email: admin.email,
			impersonating: false
		});
	});
});
