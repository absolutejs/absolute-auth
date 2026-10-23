import { expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import {
	changeImpersonationMode,
	endImpersonation,
	ImpersonationError,
	startImpersonation
} from '../src/session/impersonation';
import { userSessionIdTypebox } from '../src/typebox';
import type { AuditEvent } from '../src/audit/types';

type User = { sub: string };
const admin = { sub: 'admin' };
const member = { sub: 'member' };
const build = async ({
	age = 0,
	anonymous = false,
	expiresIn = 60000
} = {}) => {
	const sessions = createInMemoryAuthSessionStore<User>();
	const id = crypto.randomUUID();
	await sessions.setSession(id, {
		anonymous,
		authenticatedAt: Date.now() - age,
		expiresAt: Date.now() + expiresIn,
		user: admin
	});
	const events: AuditEvent[] = [];
	const control = { allowed: true, auditFailure: false };
	const emit = (event: AuditEvent) => {
		if (control.auditFailure) throw new Error('Audit unavailable');
		events.push(event);
	};
	const policy = {
		emit,
		authorize: () => control.allowed,
		getUserId: (user: User) => user.sub
	};
	const app = new Elysia()
		.onError(({ error, status }) =>
			error instanceof ImpersonationError
				? status(error.status, {
						code: error.code,
						message: error.message
					})
				: undefined
		)
		.post(
			'/start',
			{
				body: t.Object({
					reason: t.String(),
					self: t.Optional(t.Boolean())
				}),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			},
			async ({ cookie, body }) => {
				await startImpersonation({
					...policy,
					authSessionStore: sessions,
					cookie: cookie.user_session_id,
					inMemorySession: {},
					reason: body.reason,
					user: body.self ? admin : member
				});

				return { ok: true };
			}
		)
		.post(
			'/mode',
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) },
			({ cookie }) =>
				changeImpersonationMode({
					...policy,
					authSessionStore: sessions,
					cookie: cookie.user_session_id,
					inMemorySession: {},
					mode: 'live'
				})
		)
		.post(
			'/end',
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) },
			({ cookie }) =>
				endImpersonation({
					...policy,
					authSessionStore: sessions,
					cookie: cookie.user_session_id,
					inMemorySession: {}
				})
		);
	const send = (
		path: string,
		cookie = `user_session_id=${id}`,
		body: object = { reason: 'support ticket verification' }
	) =>
		app.handle(
			new Request(`http://localhost${path}`, {
				body: JSON.stringify(body),
				headers: { 'content-type': 'application/json', cookie },
				method: 'POST'
			})
		);

	return { control, events, id, send, sessions };
};
const responseCookie = (response: Response) =>
	response.headers
		.getSetCookie()
		.find((value) => value.startsWith('user_session_id='))
		?.split(';')[0] ?? '';

for (const [name, options, code] of [
	['expired', { expiresIn: -1 }, 'authentication_required'],
	['anonymous', { anonymous: true }, 'authentication_required'],
	['stale', { age: 600000 }, 'reauthentication_required'],
	['future authentication', { age: -600000 }, 'reauthentication_required']
] as const) {
	test(`package rejects ${name} callers without issuing a member session`, async () => {
		const setup = await build(options);
		const response = await setup.send('/start');
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code });
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(setup.events).toEqual([]);
	});
}
test('permission, target and reason are checked before creating a session', async () => {
	const setup = await build();
	setup.control.allowed = false;
	expect((await setup.send('/start')).status).toBe(403);
	setup.control.allowed = true;
	expect(
		(
			await setup.send('/start', undefined, {
				reason: 'support verification',
				self: true
			})
		).status
	).toBe(400);
	expect(
		(await setup.send('/start', undefined, { reason: 'short' })).status
	).toBe(400);
	expect(setup.events).toEqual([]);
});
test('ghost is the default and actor identity comes from the authenticated session', async () => {
	const setup = await build();
	const response = await setup.send('/start');
	const cookie = responseCookie(response);
	const session = await setup.sessions.getSession(cookie.split('=')[1]);
	expect(session?.impersonator).toMatchObject({
		actorId: admin.sub,
		readOnly: true,
		suppressSideEffects: false
	});
	expect(setup.events[0]).toMatchObject({
		metadata: { actorId: admin.sub, mode: 'ghost' },
		type: 'impersonation_started',
		userId: member.sub
	});
});
test('mode escalation rechecks current permission and rolls back if auditing fails', async () => {
	const setup = await build();
	const cookie = responseCookie(await setup.send('/start'));
	setup.control.allowed = false;
	expect((await setup.send('/mode', cookie)).status).toBe(403);
	setup.control.allowed = true;
	setup.control.auditFailure = true;
	expect((await setup.send('/mode', cookie)).status).toBe(500);
	expect(
		(await setup.sessions.getSession(cookie.split('=')[1]))?.impersonator
			?.readOnly
	).toBe(true);
	setup.control.auditFailure = false;
	expect((await setup.send('/mode', cookie)).status).toBe(200);
	expect(setup.events.at(-1)?.type).toBe('impersonation_mode_changed');
});
test('an exit audit failure leaves a valid member session and a retry can restore admin', async () => {
	const setup = await build();
	const cookie = responseCookie(await setup.send('/start'));
	setup.control.auditFailure = true;
	expect((await setup.send('/end', cookie)).status).toBe(500);
	expect(await setup.sessions.getSession(cookie.split('=')[1])).toBeDefined();
	setup.control.auditFailure = false;
	const response = await setup.send('/end', cookie);
	expect(await response.json()).toEqual({ restored: true });
	expect(responseCookie(response)).toBe(`user_session_id=${setup.id}`);
});

test('revoking the original session prevents mode escalation but still permits exit', async () => {
 const setup = await build();
 const cookie = responseCookie(await setup.send('/start'));
 await setup.sessions.removeSession(setup.id);
 expect((await setup.send('/mode', cookie)).status).toBe(401);
 const response = await setup.send('/end', cookie);
 expect(await response.json()).toEqual({ restored: false });
 expect(await setup.sessions.getSession(cookie.split('=')[1])).toBeUndefined();
});

test('stale original authentication cannot enable actions', async () => {
 const setup = await build();
 const cookie = responseCookie(await setup.send('/start'));
 const actor = await setup.sessions.getSession(setup.id);
 if (!actor) throw new Error('Missing actor fixture');
 await setup.sessions.setSession(setup.id, {...actor, authenticatedAt: Date.now() - 600000});
 const response = await setup.send('/mode', cookie);
 expect(response.status).toBe(401);
 expect(await response.json()).toMatchObject({code: 'reauthentication_required'});
 expect((await setup.sessions.getSession(cookie.split('=')[1]))?.impersonator?.readOnly).toBe(true);
});

test('a failed start audit restores the caller cookie instead of exposing member access', async () => {
 const setup = await build();
 setup.control.auditFailure = true;
 const response = await setup.send('/start');
 expect(response.status).toBe(500);
 expect(responseCookie(response)).toBe(`user_session_id=${setup.id}`);
 expect((await setup.sessions.getSession(setup.id))?.user).toEqual(admin);
 expect(setup.events).toEqual([]);
});
