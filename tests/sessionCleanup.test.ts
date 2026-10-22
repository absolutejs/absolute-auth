import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { sessionCleanup } from '../src/session/cleanup';
import type { AuthSessionStore } from '../src/session/types';
import type { OnSessionCleanup } from '../src/types';

type TestUser = { sub: string };

const unusedStoreMethods = {
	getSession: async () => undefined,
	getUnregisteredSession: async () => undefined,
	removeSession: async () => undefined,
	removeUnregisteredSession: async () => undefined,
	setSession: async () => undefined,
	setUnregisteredSession: async () => undefined
} satisfies AuthSessionStore<TestUser>;

describe('session cleanup lifecycle', () => {
	test('reports exact SQL fast-path deletion counts to the hook', async () => {
		const events: Parameters<NonNullable<OnSessionCleanup<TestUser>>>[0][] =
			[];
		const authSessionStore: AuthSessionStore<TestUser> = {
			...unusedStoreMethods,
			deleteExpired: async () => 2,
			deleteExpiredUnregistered: async () => 3
		};
		const plugin = sessionCleanup({
			authSessionStore,
			onSessionCleanup: (event) => {
				events.push(event);
			}
		});
		const app = new Elysia()
			.use(plugin)
			.get('/cleanup', async ({ cleanupSessions }) => {
				await cleanupSessions();

				return 'ok';
			});

		const response = await app.handle(
			new Request('http://localhost/cleanup')
		);

		expect(response.status).toBe(200);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			removedSessionCount: 2,
			removedUnregisteredSessionCount: 3
		});
		expect(events[0]?.removedSessions.size).toBe(0);
		expect(events[0]?.removedUnregisteredSessions.size).toBe(0);
	});

	/* Elysia 2.0.0-rc.0 removed the setup/cleanup lifecycle the sweep ran on;
	 * it now follows the server's own onStart and onStop. */
	test('sweeps on an interval while the server runs, and stops with it', async () => {
		let sweeps = 0;
		const authSessionStore: AuthSessionStore<TestUser> = {
			...unusedStoreMethods,
			deleteExpired: async () => {
				sweeps += 1;

				return 0;
			},
			deleteExpiredUnregistered: async () => 0
		};
		const app = new Elysia()
			.use(sessionCleanup({ authSessionStore, cleanupIntervalMs: 10 }))
			.get('/', () => 'ok');
		expect(sweeps).toBe(0);

		app.listen(0);
		await Bun.sleep(80);
		expect(sweeps).toBeGreaterThan(0);

		await app.stop();
		const stoppedAt = sweeps;
		await Bun.sleep(60);
		expect(sweeps).toBe(stoppedAt);
	});
});
