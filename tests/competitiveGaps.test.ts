import { beforeEach, describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import {
	isDisposableEmail,
	validateEmailDeliverability
} from '../src/credentials/emailValidation';
import { loadSessionFromSource } from '../src/session/access';
import {
	createAnonymousSession,
	isAnonymousSession
} from '../src/session/anonymous';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import {
	addToSessionRing,
	listRingSessions,
	removeFromSessionRing,
	switchActiveSession
} from '../src/session/multiSession';
import { promoteToSession } from '../src/session/promote';
import { sessionStore } from '../src/session/state';
import { userSessionIdTypebox } from '../src/typebox';

type TestUser = { email: string; sub: string };

const HOUR_MS = 3_600_000;
const cookieSchema = {
	cookie: t.Cookie({
		session_ring: t.Optional(t.String()),
		user_session_id: t.Optional(userSessionIdTypebox)
	})
};

const buildApp = () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();

	return new Elysia()
		.use(sessionStore<TestUser>())
		.post(
			'/guest',
			async ({ cookie: { user_session_id }, store: { session } }) => {
				await createAnonymousSession({
					authSessionStore,
					cookie: user_session_id,
					guestUser: { email: '', sub: 'guest:1' },
					inMemorySession: session
				});

				return { ok: true };
			},
			cookieSchema
		)
		.post(
			'/login',
			async ({
				body: { sub },
				cookie: { session_ring, user_session_id },
				store: { session }
			}) => {
				const sessionId = await promoteToSession({
					authSessionStore,
					cookie: user_session_id,
					inMemorySession: session,
					sessionDurationMs: HOUR_MS,
					user: { email: `${sub}@acme.test`, sub }
				});
				addToSessionRing(session_ring, sessionId);

				return { ok: true };
			},
			{ ...cookieSchema, body: t.Object({ sub: t.String() }) }
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
					anonymous: isAnonymousSession(current),
					sub: current?.user.sub ?? null
				};
			},
			cookieSchema
		)
		.get(
			'/accounts',
			async ({ cookie: { session_ring } }) => {
				const accounts = await listRingSessions({
					authSessionStore,
					ring: session_ring
				});

				return accounts.map((entry) => ({
					sessionId: entry.sessionId,
					sub: entry.user.sub
				}));
			},
			cookieSchema
		)
		.post(
			'/switch',
			({
				body: { sessionId },
				cookie: { session_ring, user_session_id }
			}) => ({
				switched: switchActiveSession({
					activeCookie: user_session_id,
					ring: session_ring,
					sessionId
				})
			}),
			{ ...cookieSchema, body: t.Object({ sessionId: t.String() }) }
		)
		.post(
			'/signout-one',
			async ({
				body: { sessionId },
				cookie: { session_ring, user_session_id }
			}) => {
				await removeFromSessionRing({
					activeCookie: user_session_id,
					authSessionStore,
					ring: session_ring,
					sessionId
				});

				return { ok: true };
			},
			{ ...cookieSchema, body: t.Object({ sessionId: t.String() }) }
		);
};

// Maintain a cookie jar across requests (we juggle two cookies).
const jarFrom = (response: Response, previous: string) => {
	const jar = new Map(
		previous
			.split('; ')
			.filter(Boolean)
			.map((entry) => [entry.split('=')[0], entry])
	);
	for (const setCookie of response.headers.getSetCookie()) {
		const pair = setCookie.split(';')[0] ?? '';
		jar.set(pair.split('=')[0], pair);
	}

	return [...jar.values()].join('; ');
};

const request = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	method: string,
	cookie: string,
	body?: unknown
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: body === undefined ? undefined : JSON.stringify(body),
			headers:
				body === undefined
					? { cookie }
					: { 'content-type': 'application/json', cookie },
			method
		})
	);

describe('anonymous sessions', () => {
	test('createAnonymousSession flags the session as anonymous', async () => {
		const app = buildApp();
		const guest = await request(app, '/guest', 'POST', '');
		const cookie = jarFrom(guest, '');

		const who = await (await request(app, '/whoami', 'GET', cookie)).json();
		expect(who).toEqual({ anonymous: true, sub: 'guest:1' });
	});
});

describe('multi-session (account switcher)', () => {
	let app = buildApp();

	beforeEach(() => {
		app = buildApp();
	});

	test('holds multiple accounts, switches, and signs one out', async () => {
		let jar = '';
		jar = jarFrom(
			await request(app, '/login', 'POST', jar, { sub: 'alice' }),
			jar
		);
		jar = jarFrom(
			await request(app, '/login', 'POST', jar, { sub: 'bob' }),
			jar
		);

		const accounts = await (
			await request(app, '/accounts', 'GET', jar)
		).json();
		expect(accounts.map((a: { sub: string }) => a.sub).sort()).toEqual([
			'alice',
			'bob'
		]);

		// most recent login (bob) is active
		expect(
			(await (await request(app, '/whoami', 'GET', jar)).json()).sub
		).toBe('bob');

		const aliceId = accounts.find(
			(a: { sub: string }) => a.sub === 'alice'
		).sessionId;
		jar = jarFrom(
			await request(app, '/switch', 'POST', jar, { sessionId: aliceId }),
			jar
		);
		expect(
			(await (await request(app, '/whoami', 'GET', jar)).json()).sub
		).toBe('alice');

		const bobId = accounts.find(
			(a: { sub: string }) => a.sub === 'bob'
		).sessionId;
		jar = jarFrom(
			await request(app, '/signout-one', 'POST', jar, {
				sessionId: bobId
			}),
			jar
		);
		const after = await (
			await request(app, '/accounts', 'GET', jar)
		).json();
		expect(after.map((a: { sub: string }) => a.sub)).toEqual(['alice']);
	});
});

describe('email deliverability validation', () => {
	test('accepts a normal address', async () => {
		expect(await validateEmailDeliverability('alice@acme.com')).toEqual({
			ok: true
		});
	});

	test('rejects bad format and disposable domains', async () => {
		expect((await validateEmailDeliverability('not-an-email')).reason).toBe(
			'invalid_format'
		);
		expect(
			(await validateEmailDeliverability('x@mailinator.com')).reason
		).toBe('disposable');
	});

	test('isDisposableEmail honors extra domains', () => {
		expect(isDisposableEmail('x@throwaway.test', ['throwaway.test'])).toBe(
			true
		);
		expect(isDisposableEmail('x@acme.com')).toBe(false);
	});
});
