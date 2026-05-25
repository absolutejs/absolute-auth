import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createInMemoryAuditSink } from '../src/audit/inMemoryAuditStore';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { auth } from '../src/index';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

type TestUser = {
	email: string;
	sub: string;
};

const buildApp = async () => {
	const sink = createInMemoryAuditSink();
	const credentialStore = createInMemoryCredentialStore();
	const users = new Map<string, TestUser>();
	const authInstance = await auth<TestUser>({
		audit: { auditStore: sink, getUserId: (user) => user.sub },
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
		providersConfiguration: {}
	});
	const app = new Elysia().use(authInstance);

	return { app, sink };
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

describe('audit logging', () => {
	test('in-memory sink lists newest-first and filters by user', async () => {
		const sink = createInMemoryAuditSink();

		await sink.append({ at: 100, type: 'register', userId: 'a' });
		await sink.append({ at: 200, type: 'credentials_login', userId: 'a' });
		await sink.append({ at: 300, type: 'credentials_login', userId: 'b' });

		const all = (await sink.list?.()) ?? [];
		expect(all[0]?.at).toBe(300);
		expect((await sink.list?.({ userId: 'a' })) ?? []).toHaveLength(2);
		expect((await sink.list?.({ limit: 1 })) ?? []).toHaveLength(1);
	});

	test('auth() emits events for register, failed login, and login', async () => {
		const { app, sink } = await buildApp();

		await post(app, '/auth/register', {
			email: 'audit@example.com',
			password: 'supersecret'
		});
		await post(app, '/auth/login', {
			email: 'audit@example.com',
			password: 'wrongpass'
		});
		await post(app, '/auth/login', {
			email: 'audit@example.com',
			password: 'supersecret'
		});

		const events = (await sink.list?.()) ?? [];
		const types = events.map((event) => event.type);

		expect(types).toContain('register');
		expect(types).toContain('credentials_login_failed');
		expect(types).toContain('credentials_login');
	});
});
