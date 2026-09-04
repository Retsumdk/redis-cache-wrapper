import { describe, test, expect } from "bun:test";
import { RedisCacheWrapper } from "../src/cache";
import { MemoryStore } from "../src/store";

function makeCache(opts = {}) {
  const store = new MemoryStore();
  const cache = new RedisCacheWrapper(store, opts);
  return { store, cache };
}

describe("RedisCacheWrapper (MemoryStore backend)", () => {
  test("set then get returns the stored value", async () => {
    const { cache } = makeCache();
    await cache.set("user:1", { name: "Ada" });
    expect(await cache.get("user:1")).toEqual({ name: "Ada" });
  });

  test("get returns null on a miss", async () => {
    const { cache } = makeCache();
    expect(await cache.get("missing")).toBeNull();
  });

  test("entries expire after their TTL", async () => {
    const { cache } = makeCache();
    await cache.set("temp", "v", 50);
    expect(await cache.get("temp")).toBe("v");
    await new Promise((r) => setTimeout(r, 80));
    expect(await cache.get("temp")).toBeNull();
  });

  test("default TTL from options applies to set", async () => {
    const { cache } = makeCache({ ttlMs: 40 });
    await cache.set("k", 1);
    await new Promise((r) => setTimeout(r, 70));
    expect(await cache.get("k")).toBeNull();
  });

  test("delete removes a key and reports existence", async () => {
    const { cache } = makeCache();
    await cache.set("k", "v");
    expect(await cache.delete("k")).toBe(true);
    expect(await cache.get("k")).toBeNull();
    expect(await cache.delete("k")).toBe(false);
  });

  test("flush clears all keys", async () => {
    const { cache } = makeCache();
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.flush();
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBeNull();
  });

  test("wrap caches the loader result and short-circuits on repeat", async () => {
    const { cache } = makeCache({ ttlMs: 60_000 });
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { id: 7 };
    };
    const first = await cache.wrap("api:7", loader);
    const second = await cache.wrap("api:7", loader);
    expect(first).toEqual({ id: 7 });
    expect(second).toEqual({ id: 7 });
    expect(calls).toBe(1);
  });

  test("wrap recomputes after TTL expires", async () => {
    const { cache } = makeCache();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };
    await cache.wrap("k", loader, { ttlMs: 40 });
    await new Promise((r) => setTimeout(r, 70));
    await cache.wrap("k", loader, { ttlMs: 40 });
    expect(calls).toBe(2);
  });

  test("wrap propagates loader errors", async () => {
    const { cache } = makeCache();
    const loader = async () => {
      throw new Error("boom");
    };
    await expect(cache.wrap("k", loader)).rejects.toThrow("boom");
  });

  test("namespacing isolates keys", async () => {
    const { cache } = makeCache({ namespace: "v1" });
    await cache.set("k", "nested");
    expect(await cache.get("k")).toBe("nested");
  });

  test("stats track hits, misses, and hit rate", async () => {
    const { cache } = makeCache();
    await cache.set("k", 1);
    await cache.get("k"); // hit
    await cache.get("k"); // hit
    await cache.get("nope"); // miss
    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3);
  });

  test("different namespaces on the same store do not collide", async () => {
    const store = new MemoryStore();
    const a = new RedisCacheWrapper(store, { namespace: "a" });
    const b = new RedisCacheWrapper(store, { namespace: "b" });
    await a.set("k", "A");
    await b.set("k", "B");
    expect(await a.get("k")).toBe("A");
    expect(await b.get("k")).toBe("B");
  });
});
