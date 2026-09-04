import type { CacheEntry, CacheStore } from "./store";
import { isFresh, makeEntry } from "./store";

export interface CacheOptions {
  /**
   * Default time-to-live in milliseconds applied to values written through
   * `set` / `wrap` when no per-call TTL is supplied. `0` (the default) means
   * entries never expire.
   */
  ttlMs?: number;
  /**
   * Optional namespace prepended to every key, preventing collisions across
   * caches sharing the same store.
   */
  namespace?: string;
  /**
   * When `true`, a store failure inside `wrap` is swallowed and the loader is
   * invoked directly, so a cache outage degrades to uncached behavior instead
   * of failing the request. Defaults to `true`.
   */
  degradeOnError?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  writes: number;
  deletes: number;
  errors: number;
  hitRate: number;
}

/**
 * A thin, typed caching layer for API responses and expensive computations.
 *
 * The wrapper is backend-agnostic: point it at a `MemoryStore` for
 * development/tests or a `RedisStore` for production and the same code works.
 * It adds TTL handling, namespacing, hit/miss observability, and a
 * `wrap` memoizer that turns any async producer into a cache-first function.
 */
export class RedisCacheWrapper {
  private readonly store: CacheStore;
  private readonly options: CacheOptions;
  private readonly stats: CacheStats = {
    hits: 0,
    misses: 0,
    writes: 0,
    deletes: 0,
    errors: 0,
    hitRate: 0,
  };

  constructor(store: CacheStore, options: CacheOptions = {}) {
    this.store = store;
    this.options = {
      ttlMs: options.ttlMs ?? 0,
      namespace: options.namespace,
      degradeOnError: options.degradeOnError ?? true,
    };
  }

  private namespaced(key: string): string {
    return this.options.namespace ? `${this.options.namespace}:${key}` : key;
  }

  private recordHit(): void {
    this.stats.hits += 1;
    this.recomputeHitRate();
  }

  private recordMiss(): void {
    this.stats.misses += 1;
    this.recomputeHitRate();
  }

  private recomputeHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /** Reads a value from cache, returning `null` on miss or expired entry. */
  async get<T>(key: string): Promise<T | null> {
    const entry = await this.getEntry<T>(key);
    return entry ? entry.value : null;
  }

  /** Reads a full cache entry (value + metadata) or `null`. */
  async getEntry<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const entry = await this.store.get<T>(this.namespaced(key));
      if (entry && isFresh(entry)) {
        this.recordHit();
        return entry;
      }
      this.recordMiss();
      return null;
    } catch (err) {
      this.stats.errors += 1;
      this.recordMiss();
      throw err;
    }
  }

  /** Writes a value into cache with an optional per-call TTL. */
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.options.ttlMs;
    await this.store.set(
      this.namespaced(key),
      makeEntry(value, ttl !== undefined && ttl > 0 ? ttl : undefined),
    );
    this.stats.writes += 1;
  }

  /** Removes a key, returning `true` if it existed. */
  async delete(key: string): Promise<boolean> {
    const removed = await this.store.delete(this.namespaced(key));
    if (removed) this.stats.deletes += 1;
    return removed;
  }

  /** Empts the entire cache (all namespaced keys). */
  async flush(): Promise<void> {
    await this.store.flush();
  }

  /**
   * Memoizes an async producer: returns the cached value if fresh, otherwise
   * runs `loader`, stores the result, and returns it. This is the core pattern
   * for caching API responses — call it instead of the upstream fetch.
   *
   * If the store fails and `degradeOnError` is set, the loader runs directly so
   * a cache outage never breaks the caller.
   */
  async wrap<T>(
    key: string,
    loader: () => Promise<T>,
    opts: { ttlMs?: number } = {},
  ): Promise<T> {
    const cached = await this.getEntry<T>(key);
    if (cached) return cached.value;

    // Loader failures are always propagated to the caller.
    const value = await loader();

    const ttl = opts.ttlMs ?? this.options.ttlMs;
    if (ttl !== undefined && ttl > 0) {
      try {
        await this.set(key, value, ttl);
      } catch (err) {
        this.stats.errors += 1;
        if (!this.options.degradeOnError) throw err;
      }
    }
    return value;
  }

  /** Returns a snapshot of cumulative cache statistics. */
  getStats(): CacheStats {
    return { ...this.stats };
  }
}
