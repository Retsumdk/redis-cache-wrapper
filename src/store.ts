/**
 * CacheStore contract and the two built-in backends:
 *  - MemoryStore: zero-dependency in-memory backend (default for tests / dev).
 *  - RedisStore:  production backend backed by a real Redis server via ioredis.
 */

import Redis from "ioredis";

/** A single cache entry, serializable to JSON for the Redis backend. */
export interface CacheEntry<T = unknown> {
  /** The cached payload. */
  value: T;
  /** Epoch ms when the entry was written. */
  createdAt: number;
  /** Epoch ms when the entry expires; 0 means "no expiry". */
  expiresAt: number;
  /** Number of times this entry has been served from cache. */
  hitCount: number;
}

/** Storage contract. Implementations must be safe to call concurrently. */
export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  flush(): Promise<void>;
}

/** Builds a cache entry from a value and an optional TTL in milliseconds.
 *  - `ttlMs === undefined` → no expiry (`expiresAt === 0`).
 *  - `ttlMs > 0` → expires `ttlMs` ms from now.
 *  - `ttlMs <= 0` → already expired.
 */
export function makeEntry<T>(value: T, ttlMs?: number): CacheEntry<T> {
  const createdAt = Date.now();
  if (ttlMs === undefined) {
    return { value, createdAt, expiresAt: 0, hitCount: 0 };
  }
  return { value, createdAt, expiresAt: createdAt + ttlMs, hitCount: 0 };
}

/** Returns `true` while an entry is within its TTL window (or has no TTL). */
export function isFresh(entry: CacheEntry): boolean {
  return entry.expiresAt === 0 || Date.now() <= entry.expiresAt;
}

/** In-memory backend. Entries are pruned lazily on read when they expire. */
export class MemoryStore implements CacheStore {
  private readonly data = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return null;
    }
    return entry as CacheEntry<T>;
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    this.data.set(key, entry);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async flush(): Promise<void> {
    this.data.clear();
  }

  /** Number of live entries (including not-yet-pruned expired ones). */
  get size(): number {
    return this.data.size;
  }
}

/** Redis backend. Stores entries as JSON strings with a server-side TTL. */
export class RedisStore implements CacheStore {
  private readonly prefix: string;

  constructor(
    private readonly client: Redis,
    prefix = "rcw:",
  ) {
    this.prefix = prefix;
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const raw = await this.client.get(this.key(key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CacheEntry<T>;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    const raw = JSON.stringify(entry);
    const ttlSeconds = entry.expiresAt
      ? Math.max(1, Math.round((entry.expiresAt - Date.now()) / 1000))
      : 0;
    if (ttlSeconds > 0) {
      await this.client.setex(this.key(key), ttlSeconds, raw);
    } else {
      await this.client.set(this.key(key), raw);
    }
  }

  async delete(key: string): Promise<boolean> {
    return (await this.client.del(this.key(key))) > 0;
  }

  async flush(): Promise<void> {
    const keys = await this.client.keys(`${this.prefix}*`);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}
