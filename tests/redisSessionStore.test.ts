import { describe, expect, test } from 'bun:test';
import {
	createRedisAuthSessionStore,
	type RedisSessionClient
} from '../src/session/redisStore';
import type { SessionData, UserSessionId } from '../src/types';
import { listUserSessions, revokeUserSessions } from '../src/session/userSessions';

type TestUser = { id: string };

const TTL_MS = 60_000;

// Fake Redis with the `keys` glob the session store needs for listing.
const createFakeRedis = (): RedisSessionClient => {
	const map = new Map<string, string>();

	return {
		del: async (key) => map.delete(key),
		get: async (key) => map.get(key) ?? null,
		keys: async (pattern) => {
			const prefix = pattern.endsWith('*')
				? pattern.slice(0, -1)
				: pattern;

			return [...map.keys()].filter((key) => key.startsWith(prefix));
		},
		set: async (key, value) => map.set(key, value)
	};
};

const session = (userId: string): SessionData<TestUser> => ({
	expiresAt: Date.now() + TTL_MS,
	user: { id: userId }
});

describe('redis auth session store', () => {
	test('round-trips a session and removes it', async () => {
		const store = createRedisAuthSessionStore<TestUser>(createFakeRedis());
		const id = crypto.randomUUID() as UserSessionId;

		await store.setSession(id, session('alice'));
		expect((await store.getSession(id))?.user.id).toBe('alice');

		await store.removeSession(id);
		expect(await store.getSession(id)).toBeUndefined();
	});

	test('lists session ids (device management)', async () => {
		const store = createRedisAuthSessionStore<TestUser>(createFakeRedis());
		const idA = crypto.randomUUID() as UserSessionId;
		const idB = crypto.randomUUID() as UserSessionId;

		await store.setSession(idA, session('alice'));
		await store.setSession(idB, session('bob'));

		const ids = await store.listSessionIds?.();
		expect(ids?.sort()).toEqual([idA, idB].sort());
	});

	test('listUserSessions / revokeUserSessions scope to one user', async () => {
		const store = createRedisAuthSessionStore<TestUser>(createFakeRedis());
		const getUserId = (user: TestUser) => user.id;
		const first = crypto.randomUUID() as UserSessionId;
		const second = crypto.randomUUID() as UserSessionId;
		const other = crypto.randomUUID() as UserSessionId;

		await store.setSession(first, session('alice'));
		await store.setSession(second, session('alice'));
		await store.setSession(other, session('bob'));

		const aliceSessions = await listUserSessions({
			authSessionStore: store,
			getUserId,
			userId: 'alice'
		});
		expect(aliceSessions.length).toBe(2);

		// Sign out everywhere except the current session.
		const revoked = await revokeUserSessions({
			authSessionStore: store,
			exceptSessionId: first,
			getUserId,
			userId: 'alice'
		});
		expect(revoked).toBe(1);
		expect(await store.getSession(first)).toBeDefined();
		expect(await store.getSession(second)).toBeUndefined();
		// Other users are untouched.
		expect(await store.getSession(other)).toBeDefined();
	});
});
