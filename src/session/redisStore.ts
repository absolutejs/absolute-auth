import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { RedisLike } from '../stores/redis';
import { isUserSessionId } from '../typeGuards';
import type {
	SessionData,
	UserSessionId
} from '../types';
import type { AuthSessionStore, SessionUserDecoder } from './types';

// Listing sessions (for device management) needs key enumeration, which the minimal RedisLike
// (get/set/del) can't do — so the session store additionally requires `keys`. ioredis, node-redis,
// @upstash/redis, and Bun's RedisClient all provide it. At very large scale, back this with a
// SCAN-based `keys` implementation to avoid blocking Redis.
export type RedisSessionClient = RedisLike & {
	keys: (pattern: string) => Promise<string[]>;
};

const SESSION_SEGMENT = 'sess:';
const UNREGISTERED_SEGMENT = 'unreg:';

const impersonatorSchema = Type.Object({
	actorEmail: Type.Optional(Type.String()),
	actorId: Type.String(),
	readOnly: Type.Optional(Type.Boolean()),
	reason: Type.String(),
	returnToSessionId: Type.Optional(Type.String()),
	startedAt: Type.Number(),
	suppressSideEffects: Type.Optional(Type.Boolean())
});
const sessionSchema = Type.Object({
	accessToken: Type.Optional(Type.String()),
	anonymous: Type.Optional(Type.Boolean()),
	authenticatedAt: Type.Optional(Type.Number()),
	expiresAt: Type.Number(),
	impersonator: Type.Optional(impersonatorSchema),
	refreshToken: Type.Optional(Type.String()),
	samlLogout: Type.Optional(
		Type.Object({
			connectionId: Type.String(),
			nameId: Type.String(),
			sessionIndex: Type.Optional(Type.String())
		})
	),
	user: Type.Unknown()
});
const unregisteredSessionSchema = Type.Object({
	accessToken: Type.Optional(Type.String()),
	expiresAt: Type.Number(),
	refreshToken: Type.Optional(Type.String()),
	sessionInformation: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	userIdentity: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
});

const parseJson = (raw: string | null) => {
	if (raw === null) return undefined;

	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
};

const parseSession = <UserType>(
	raw: string | null,
	decodeUser: SessionUserDecoder<UserType>
) => {
	const value: unknown = parseJson(raw);
	if (!Value.Check(sessionSchema, value)) return undefined;

	try {
		const {impersonator} = value;
		if (
			impersonator?.returnToSessionId !== undefined &&
			!isUserSessionId(impersonator.returnToSessionId)
		)
			return undefined;
		const session: SessionData<UserType> = {
			...value,
			impersonator:
				impersonator === undefined
					? undefined
					: {
							...impersonator,
							returnToSessionId: impersonator.returnToSessionId
						},
			user: decodeUser(value.user)
		};

		return session;
	} catch {
		return undefined;
	}
};

const parseUnregisteredSession = (raw: string | null) => {
	const value: unknown = parseJson(raw);

	return Value.Check(unregisteredSessionSchema, value) ? value : undefined;
};

// Redis-backed session store. Sessions persist across restarts/deploys and are shared across
// instances, and Redis' native per-key TTL expires them automatically (no cleanup job needed —
// `expiresAt` drives the TTL). Bring your own client adapted to `RedisSessionClient`.
export const createRedisAuthSessionStore = <UserType>(
	redis: RedisSessionClient,
	decodeUser: SessionUserDecoder<UserType>,
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
			parseSession(await redis.get(sessionKey(id)), decodeUser),
		getUnregisteredSession: async (id) =>
			parseUnregisteredSession(await redis.get(unregisteredKey(id))),
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
