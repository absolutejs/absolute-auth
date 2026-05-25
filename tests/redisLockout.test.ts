import { describe, expect, test } from 'bun:test';
import { createLockoutGuard } from '../src/lockout/config';
import { createRedisLockoutStore } from '../src/lockout/redisLockoutStore';
import type { RedisLike } from '../src/stores/redis';

const MINUTE_MS = 60_000;
const MAX_ATTEMPTS = 3;

const createFakeRedis = (): RedisLike => {
	const map = new Map<string, string>();

	return {
		del: async (key) => map.delete(key),
		get: async (key) => map.get(key) ?? null,
		set: async (key, value) => map.set(key, value)
	};
};

describe('redis lockout store', () => {
	test('locks after the threshold via the guard and resets on success', async () => {
		const guard = createLockoutGuard({
			lockoutMs: MINUTE_MS,
			lockoutStore: createRedisLockoutStore(createFakeRedis()),
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

	test('round-trips a record and clears on reset', async () => {
		const store = createRedisLockoutStore(createFakeRedis());

		await store.increment('k', MINUTE_MS);
		expect((await store.get('k'))?.failedAttempts).toBe(1);

		await store.reset('k');
		expect(await store.get('k')).toBeUndefined();
	});
});
