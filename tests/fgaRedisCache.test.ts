import { beforeEach, describe, expect, test } from 'bun:test';
import { check, type FgaConfig, writeWarrant } from '../src/fga/config';
import { createInMemoryWarrantStore } from '../src/fga/inMemoryStores';
import {
	createRedisFgaCache,
	type RedisFgaCacheClient
} from '../src/fga/redisCheckCache';
import type { FgaSchema } from '../src/fga/types';

// Repros the multi-instance use case: two FGA configs both back the same Redis-shared
// cache. Reads on the second instance must hit the cache that the first instance warmed,
// and `writeWarrant`-triggered `clear()` must invalidate across both.

const schema: FgaSchema = {
	document: { viewer: { kind: 'self' } }
};

type StoreEntry = { expiresAt: number; value: string };

// Minimal in-memory RedisLike + optional keys() shim so tests don't need a real Redis.
const createFakeRedis = (): RedisFgaCacheClient & {
	store: Map<string, StoreEntry>;
} => {
	const store = new Map<string, StoreEntry>();
	const prune = (key: string) => {
		const entry = store.get(key);
		if (entry !== undefined && entry.expiresAt < Date.now()) store.delete(key);
	};

	return {
		store,
		del: async (key) => {
			store.delete(key);
		},
		get: async (key) => {
			prune(key);

			return store.get(key)?.value ?? null;
		},
		keys: async (pattern) => {
			const prefix = pattern.replace(/\*$/u, '');

			return Array.from(store.keys()).filter((key) =>
				key.startsWith(prefix)
			);
		},
		set: async (key, value, ttlMs) => {
			store.set(key, { expiresAt: Date.now() + ttlMs, value });
		}
	};
};

describe('createRedisFgaCache', () => {
	let redis: ReturnType<typeof createFakeRedis>;
	let cache: ReturnType<typeof createRedisFgaCache>;
	let warrantStore: ReturnType<typeof createInMemoryWarrantStore>;
	let config: FgaConfig;

	beforeEach(() => {
		redis = createFakeRedis();
		cache = createRedisFgaCache(redis, { ttlMs: 60_000 });
		warrantStore = createInMemoryWarrantStore();
		config = { cache, schema, warrantStore };
	});

	test('check warms the Redis cache and a second instance hits it', async () => {
		await writeWarrant(config, {
			relation: 'viewer',
			resourceId: 'doc1',
			resourceType: 'document',
			subjectId: 'alice',
			subjectType: 'user'
		});

		const first = await check(config, {
			relation: 'viewer',
			resourceId: 'doc1',
			resourceType: 'document',
			subjectId: 'alice',
			subjectType: 'user'
		});
		expect(first).toBe(true);
		// Warmed.
		expect(redis.store.size).toBe(1);

		// Simulate a second instance: new config, same Redis (so same shared cache),
		// EMPTY warrant store. If the cache hit works across instances, the check
		// returns true even though the local warrant store knows nothing.
		const otherStore = createInMemoryWarrantStore();
		const otherConfig: FgaConfig = {
			cache: createRedisFgaCache(redis, { ttlMs: 60_000 }),
			schema,
			warrantStore: otherStore
		};
		const hit = await check(otherConfig, {
			relation: 'viewer',
			resourceId: 'doc1',
			resourceType: 'document',
			subjectId: 'alice',
			subjectType: 'user'
		});
		expect(hit).toBe(true);
	});

	test('writeWarrant clears the cache so the next check re-evaluates', async () => {
		await check(config, {
			relation: 'viewer',
			resourceId: 'doc2',
			resourceType: 'document',
			subjectId: 'bob',
			subjectType: 'user'
		});
		// Negative result is also cached.
		expect(redis.store.size).toBe(1);

		await writeWarrant(config, {
			relation: 'viewer',
			resourceId: 'doc2',
			resourceType: 'document',
			subjectId: 'bob',
			subjectType: 'user'
		});
		// Cache should have been scanned + cleared.
		expect(redis.store.size).toBe(0);

		const after = await check(config, {
			relation: 'viewer',
			resourceId: 'doc2',
			resourceType: 'document',
			subjectId: 'bob',
			subjectType: 'user'
		});
		expect(after).toBe(true);
	});

	test('TTL expiry forces a real check', async () => {
		const tinyTtlCache = createRedisFgaCache(redis, { ttlMs: 1 });
		const tinyConfig: FgaConfig = {
			cache: tinyTtlCache,
			schema,
			warrantStore
		};

		await writeWarrant(tinyConfig, {
			relation: 'viewer',
			resourceId: 'doc3',
			resourceType: 'document',
			subjectId: 'carol',
			subjectType: 'user'
		});

		await check(tinyConfig, {
			relation: 'viewer',
			resourceId: 'doc3',
			resourceType: 'document',
			subjectId: 'carol',
			subjectType: 'user'
		});
		expect(redis.store.size).toBe(1);

		// Wait past TTL; the next get() should return null after the prune.
		await new Promise((resolve) => setTimeout(resolve, 5));
		const after = await check(tinyConfig, {
			relation: 'viewer',
			resourceId: 'doc3',
			resourceType: 'document',
			subjectId: 'carol',
			subjectType: 'user'
		});
		expect(after).toBe(true);
		// Warmed again after the TTL miss.
		expect(redis.store.size).toBe(1);
	});

	test('clear() is a no-op when the client lacks keys() (TTL still bounds staleness)', async () => {
		// Strip the `keys` capability to simulate a minimal RedisLike client.
		const minimal: RedisFgaCacheClient = {
			del: redis.del,
			get: redis.get,
			set: redis.set
		};
		const minimalCache = createRedisFgaCache(minimal, { ttlMs: 60_000 });
		const minimalConfig: FgaConfig = {
			cache: minimalCache,
			schema,
			warrantStore: createInMemoryWarrantStore()
		};

		await writeWarrant(minimalConfig, {
			relation: 'viewer',
			resourceId: 'doc4',
			resourceType: 'document',
			subjectId: 'dave',
			subjectType: 'user'
		});
		await check(minimalConfig, {
			relation: 'viewer',
			resourceId: 'doc4',
			resourceType: 'document',
			subjectId: 'dave',
			subjectType: 'user'
		});
		const cacheSizeBefore = redis.store.size;

		// writeWarrant calls clear(); without keys(), the entries linger until TTL.
		await writeWarrant(minimalConfig, {
			relation: 'viewer',
			resourceId: 'doc5',
			resourceType: 'document',
			subjectId: 'dave',
			subjectType: 'user'
		});
		expect(redis.store.size).toBeGreaterThanOrEqual(cacheSizeBefore);
	});
});
