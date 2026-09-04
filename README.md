# redis-cache-wrapper

A typed, backend-agnostic **caching layer for API responses and expensive computations**, built for Node.js/Bun and TypeScript. It wraps any async producer so you get cache-first reads with **TTL expiration**, **namespacing**, **hit/miss observability**, and a zero-dependency in-memory backend for development and tests — or a real **Redis** backend for production.

```ts
const cache = new RedisCacheWrapper(new RedisStore(redis), { ttlMs: 60_000 });
const user = await cache.wrap("user:42", () => fetchUser(42)); // cache-first
```

## Why this exists

Most services recompute the same expensive work over and over: the same API response, the same DB aggregation, the same LLM call. Naive caching is easy to get wrong — keys collide, entries never expire, and a cache outage can take down the request path. `redis-cache-wrapper` makes caching a one-liner while handling the details that usually bite: TTLs, key namespacing, graceful degradation when Redis is down, and real metrics so you know whether your cache is actually helping.

## How it works

The wrapper is a thin layer over a pluggable `CacheStore`:

```
┌─────────────────────────────────────────────────────────────┐
│                    RedisCacheWrapper                        │
│   get / set / delete / flush / wrap / getStats              │
│   TTL · namespace · hit/miss counters · degrade-on-error   │
└───────────────┬─────────────────────────────────────────────┘
                │ implements CacheStore
        ┌───────┴────────┐        ┌─────────────────────┐
        │   MemoryStore  │        │     RedisStore      │
        │  (dev / tests) │        │  (production, ioredis)│
        └────────────────┘        └─────────────────────┘
```

- **`MemoryStore`** — zero-dependency in-memory backend. Entries are pruned lazily on read when they expire. Ideal for tests and local development.
- **`RedisStore`** — production backend backed by a real Redis server via `ioredis`. Entries are stored as JSON with a server-side TTL (`SETEX`), so Redis handles expiration for you.
- **`wrap(key, loader)`** — the core memoizer. Returns the cached value if fresh; otherwise runs `loader`, stores the result, and returns it. This is the pattern you call instead of hitting the upstream directly.

## Getting started

```bash
git clone https://github.com/Retsumdk/redis-cache-wrapper.git
cd redis-cache-wrapper
bun install
bun test        # run the test suite
bun run build   # type-check and emit dist/
```

## Usage

### Library API

```ts
import Redis from "ioredis";
import { RedisCacheWrapper, MemoryStore, RedisStore } from "redis-cache-wrapper";

// Development / tests — no Redis required
const dev = new RedisCacheWrapper(new MemoryStore(), { ttlMs: 60_000 });

// Production — real Redis
const prod = new RedisCacheWrapper(new RedisStore(new Redis()), {
  ttlMs: 60_000,          // default TTL for all writes
  namespace: "api:v1",     // prefix every key to avoid collisions
  degradeOnError: true,    // cache outage → run loader uncached, don't fail
});

// Cache-first fetch: hits skip the loader, misses populate the cache
const user = await prod.wrap("user:42", () => fetchUser(42));

// Explicit control
await prod.set("config", { theme: "dark" }, 5_000); // 5s TTL
const theme = await prod.get("config");
await prod.delete("config");
await prod.flush();

// Observability
console.log(prod.getStats()); // { hits, misses, writes, deletes, errors, hitRate }
```

### CLI

```bash
bun run src/cli.ts set user:42 '{"name":"Ada"}' 60   # store with 60s TTL
bun run src/cli.ts get user:42                        # read a value
bun run src/cli.ts del user:42                        # remove a key
bun run src/cli.ts flush                              # clear the cache
bun run src/cli.ts status                             # show cache stats
```

By default the CLI uses an in-memory store. Pass `--redis-url redis://localhost:6379` to target a real Redis.

## Configuration

The wrapper is configured via a `CacheOptions` object:

| Option | Default | Description |
| ------ | ------- | ----------- |
| `ttlMs` | `0` (never expires) | Default time-to-live applied to values written through `set` / `wrap` when no per-call TTL is given. |
| `namespace` | none | String prepended to every key, preventing collisions across caches sharing a store. |
| `degradeOnError` | `true` | When `true`, a store failure inside `wrap` runs the loader uncached instead of failing the request. |

## Examples

```ts
import { RedisCacheWrapper, MemoryStore } from "redis-cache-wrapper";

const cache = new RedisCacheWrapper(new MemoryStore(), { ttlMs: 60_000 });
let calls = 0;

async function fetchUser(id: number) {
  calls += 1;
  return { id, name: `User ${id}` };
}

await cache.wrap("user:1", () => fetchUser(1)); // miss → loader runs (calls = 1)
await cache.wrap("user:1", () => fetchUser(1)); // hit  → loader skipped (calls = 1)
await cache.wrap("user:2", () => fetchUser(2)); // miss → loader runs (calls = 2)

console.log(cache.getStats());
// { hits: 1, misses: 2, writes: 2, deletes: 0, errors: 0, hitRate: 0.333 }
```

## License

MIT — see [LICENSE](./LICENSE).

---

Built by [Retsumdk](https://github.com/Retsumdk)
