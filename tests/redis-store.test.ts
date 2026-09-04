import { describe, test, expect } from "bun:test";
import { RedisStore } from "../src/store";
import { makeEntry } from "../src/store";

/**
 * Adapter tests for RedisStore using a stub Redis client so the command
 * mapping is verified without requiring a live Redis server. The full
 * integration path (real Redis) is exercised by the CLI/README examples.
 */

function stubClient(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const client = {
    calls,
    async get(key: string) {
      calls.push(`get ${key}`);
      return overrides.raw ?? null;
    },
    async set(key: string, raw: string) {
      calls.push(`set ${key}`);
    },
    async setex(key: string, ttl: number, raw: string) {
      calls.push(`setex ${key} ${ttl}`);
    },
    async del(...keys: string[]) {
      calls.push(`del ${keys.join(",")}`);
      return keys.length;
    },
    async keys(pattern: string) {
      calls.push(`keys ${pattern}`);
      return ["rcw:a", "rcw:b"];
    },
    ...overrides,
  };
  return client as any;
}

describe("RedisStore adapter", () => {
  test("get parses a stored JSON entry", async () => {
    const raw = JSON.stringify(makeEntry({ ok: true }));
    const store = new RedisStore(stubClient({ raw }));
    const entry = await store.get("k");
    expect(entry?.value).toEqual({ ok: true });
  });

  test("get returns null when the key is absent", async () => {
    const store = new RedisStore(stubClient({ raw: null }));
    expect(await store.get("k")).toBeNull();
  });

  test("get returns null on corrupt JSON", async () => {
    const store = new RedisStore(stubClient({ raw: "not-json" }));
    expect(await store.get("k")).toBeNull();
  });

  test("set with a TTL issues SETEX with the remaining seconds", async () => {
    const client = stubClient();
    const store = new RedisStore(client);
    const entry = makeEntry("v", 60_000);
    await store.set("k", entry);
    expect(client.calls[0]).toMatch(/^setex rcw:k \d+$/);
  });

  test("set without a TTL issues a plain SET", async () => {
    const client = stubClient();
    const store = new RedisStore(client);
    await store.set("k", makeEntry("v"));
    expect(client.calls[0]).toBe("set rcw:k");
  });

  test("delete maps to DEL with the prefixed key", async () => {
    const client = stubClient();
    const store = new RedisStore(client);
    await store.delete("k");
    expect(client.calls[0]).toBe("del rcw:k");
  });

  test("flush scans the prefix and deletes matching keys", async () => {
    const client = stubClient();
    const store = new RedisStore(client);
    await store.flush();
    expect(client.calls[0]).toBe("keys rcw:*");
    expect(client.calls[1]).toBe("del rcw:a,rcw:b");
  });
});
