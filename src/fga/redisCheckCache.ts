import type { RedisLike } from '../stores/redis';
import type { FgaCache } from './config';

const DEFAULT_TTL_MS = 5000;
const DEFAULT_PREFIX = 'auth:fga:';

// Redis-backed `check` cache for multi-instance setups, mirroring createInMemoryCheckCache.
// Every instance shares the same Redis keyspace, so a check that hits cache on instance A
// also hits on instance B. TTL bounds staleness identically across instances.
//
// `clear()` semantics: the FGA pipeline clears the cache on every `writeWarrant` /
// `deleteWarrant` so a permission change takes effect immediately on the writing instance.
// RedisLike doesn't expose key enumeration, so without an additional `keys(pattern)`
// method, `clear()` is a no-op + the docstring notes other instances see staleness up to
// `ttlMs`. If your client (ioredis, node-redis, @upstash/redis, Bun's RedisClient) exposes
// `keys`, pass it as `RedisFgaCacheClient` and `clear()` will scan-and-delete the prefixed
// namespace. At very large scale, back the `keys` implementation with SCAN instead of KEYS
// to avoid blocking Redis.
export type RedisFgaCacheClient = RedisLike & {
	keys?: (pattern: string) => Promise<string[]>;
};

type CreateRedisFgaCacheOptions = {
	keyPrefix?: string;
	ttlMs?: number;
};

const parseBoolean = (raw: string | null) => {
	if (raw === 'true') return true;
	if (raw === 'false') return false;

	return undefined;
};

export const createRedisFgaCache = (
	redis: RedisFgaCacheClient,
	{
		keyPrefix = DEFAULT_PREFIX,
		ttlMs = DEFAULT_TTL_MS
	}: CreateRedisFgaCacheOptions = {}
): FgaCache => ({
	clear: async () => {
		const enumerate = redis.keys;
		if (enumerate === undefined) return;
		const keys = await enumerate(`${keyPrefix}*`);
		await Promise.all(keys.map((key) => redis.del(key)));
	},
	get: async (key) => parseBoolean(await redis.get(keyPrefix + key)),
	set: async (key, value) => {
		await redis.set(keyPrefix + key, value ? 'true' : 'false', ttlMs);
	}
});
