import type { RedisLike } from '../stores/redis';
import { isUserSessionId } from '../typeGuards';
import type {
	SessionData,
	UnregisteredSessionData,
	UserSessionId
} from '../types';
import type { AuthSessionStore } from './types';

// Listing sessions (for device management) needs key enumeration, which the minimal RedisLike
// (get/set/del) can't do — so the session store additionally requires `keys`. ioredis, node-redis,
// @upstash/redis, and Bun's RedisClient all provide it. At very large scale, back this with a
// SCAN-based `keys` implementation to avoid blocking Redis.
export type RedisSessionClient = RedisLike & {
	keys: (pattern: string) => Promise<string[]>;
};

const SESSION_SEGMENT = 'sess:';
const UNREGISTERED_SEGMENT = 'unreg:';

const parse = <Value>(raw: string | null) => {
	if (raw === null) return undefined;

	try {
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- deserialization boundary: the value was JSON-serialized from this exact type before being stored in Redis
		return JSON.parse(raw) as Value;
	} catch {
		return undefined;
	}
};

// Redis-backed session store. Sessions persist across restarts/deploys and are shared across
// instances, and Redis' native per-key TTL expires them automatically (no cleanup job needed —
// `expiresAt` drives the TTL). Bring your own client adapted to `RedisSessionClient`.
export const createRedisAuthSessionStore = <UserType>(
	redis: RedisSessionClient,
	keyPrefix = 'auth:session:'
): AuthSessionStore<UserType> => {
	const sessionKey = (id: UserSessionId) =>
		`${keyPrefix}${SESSION_SEGMENT}${id}`;
	const unregisteredKey = (id: UserSessionId) =>
		`${keyPrefix}${UNREGISTERED_SEGMENT}${id}`;
	const ttlFor = (expiresAt: number) => Math.max(1, expiresAt - Date.now());

	const listIds = async (segment: string) => {
		const keys = await redis.keys(`${keyPrefix}${segment}*`);
		const offset = keyPrefix.length + segment.length;

		return keys.map((key) => key.slice(offset)).filter(isUserSessionId);
	};

	return {
		getSession: async (id) =>
			parse<SessionData<UserType>>(await redis.get(sessionKey(id))),
		getUnregisteredSession: async (id) =>
			parse<UnregisteredSessionData>(
				await redis.get(unregisteredKey(id))
			),
		listSessionIds: () => listIds(SESSION_SEGMENT),
		listUnregisteredSessionIds: () => listIds(UNREGISTERED_SEGMENT),
		removeSession: async (id) => {
			await redis.del(sessionKey(id));
		},
		removeUnregisteredSession: async (id) => {
			await redis.del(unregisteredKey(id));
		},
		setSession: async (id, value) => {
			await redis.set(
				sessionKey(id),
				JSON.stringify(value),
				ttlFor(value.expiresAt)
			);
		},
		setUnregisteredSession: async (id, value) => {
			await redis.set(
				unregisteredKey(id),
				JSON.stringify(value),
				ttlFor(value.expiresAt)
			);
		}
	};
};
