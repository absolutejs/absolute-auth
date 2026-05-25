import type { RedisLike } from '../stores/redis';
import type { LockoutRecord, LockoutStore } from './types';

const DEFAULT_PREFIX = 'auth:lockout:';

const toRecord = (raw: string, key: string): LockoutRecord | undefined => {
	const parsed: unknown = JSON.parse(raw);
	if (typeof parsed !== 'object' || parsed === null) return undefined;

	const failedAttempts = Reflect.get(parsed, 'failedAttempts');
	const windowStartedAt = Reflect.get(parsed, 'windowStartedAt');
	const lockedUntil = Reflect.get(parsed, 'lockedUntil');
	if (
		typeof failedAttempts !== 'number' ||
		typeof windowStartedAt !== 'number'
	) {
		return undefined;
	}

	return {
		failedAttempts,
		key,
		lockedUntil: typeof lockedUntil === 'number' ? lockedUntil : undefined,
		windowStartedAt
	};
};

// Redis-backed lockout: the canonical fit (fast, cluster-shared, and TTL auto-expires
// stale counters so no cleanup job is needed). Counters live as JSON keyed by identity.
export const createRedisLockoutStore = (
	redis: RedisLike,
	keyPrefix = DEFAULT_PREFIX
): LockoutStore => {
	const read = async (key: string) => {
		const raw = await redis.get(keyPrefix + key);

		return raw ? toRecord(raw, key) : undefined;
	};

	return {
		get: read,
		increment: async (key, windowMs) => {
			const now = Date.now();
			const existing = await read(key);
			const next: LockoutRecord =
				existing !== undefined &&
				now - existing.windowStartedAt <= windowMs
					? {
							...existing,
							failedAttempts: existing.failedAttempts + 1
						}
					: { failedAttempts: 1, key, windowStartedAt: now };
			await redis.set(keyPrefix + key, JSON.stringify(next), windowMs);

			return next;
		},
		lock: async (key, lockedUntil) => {
			const existing = (await read(key)) ?? {
				failedAttempts: 0,
				key,
				windowStartedAt: Date.now()
			};
			const ttlMs = Math.max(lockedUntil - Date.now(), 1);
			await redis.set(
				keyPrefix + key,
				JSON.stringify({ ...existing, lockedUntil }),
				ttlMs
			);
		},
		reset: async (key) => {
			await redis.del(keyPrefix + key);
		}
	};
};
