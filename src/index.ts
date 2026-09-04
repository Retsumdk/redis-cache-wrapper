/**
 * Public entry point for the library API.
 *
 * ```ts
 * import { RedisCacheWrapper, MemoryStore, RedisStore } from "redis-cache-wrapper";
 * import Redis from "ioredis";
 *
 * const cache = new RedisCacheWrapper(new RedisStore(new Redis()), { ttlMs: 60_000 });
 * const data = await cache.wrap("users:42", () => fetchUser(42));
 * ```
 */

export { RedisCacheWrapper } from "./cache";
export type { CacheOptions, CacheStats } from "./cache";
export { MemoryStore, RedisStore } from "./store";
export type { CacheEntry, CacheStore } from "./store";
export { isFresh, makeEntry } from "./store";
