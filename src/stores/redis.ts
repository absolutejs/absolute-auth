// Minimal Redis contract the auth Redis stores depend on. Bring your own client
// (ioredis / node-redis / @upstash/redis) and adapt it to this shape — the package
// bundles no Redis driver. `set` MUST apply the TTL (in milliseconds) atomically, e.g.
//   ioredis:        (k, v, ttlMs) => client.set(k, v, 'PX', ttlMs)
//   node-redis:     (k, v, ttlMs) => client.set(k, v, { PX: ttlMs })
//   @upstash/redis: (k, v, ttlMs) => client.set(k, v, { px: ttlMs })
export type RedisLike = {
	del: (key: string) => Promise<unknown>;
	get: (key: string) => Promise<string | null>;
	set: (key: string, value: string, ttlMs: number) => Promise<unknown>;
};
