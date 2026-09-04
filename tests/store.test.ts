import { describe, test, expect } from "bun:test";
import { MemoryStore, makeEntry, isFresh } from "../src/store";

describe("MemoryStore", () => {
  test("returns null for a missing key", async () => {
    const store = new MemoryStore();
    expect(await store.get("nope")).toBeNull();
  });

  test("set/get round-trips a value", async () => {
    const store = new MemoryStore();
    await store.set("k", makeEntry({ a: 1 }));
    expect((await store.get("k"))?.value).toEqual({ a: 1 });
  });

  test("delete returns true only when the key existed", async () => {
    const store = new MemoryStore();
    await store.set("k", makeEntry(1));
    expect(await store.delete("k")).toBe(true);
    expect(await store.delete("k")).toBe(false);
  });

  test("flush empties the store", async () => {
    const store = new MemoryStore();
    await store.set("a", makeEntry(1));
    await store.set("b", makeEntry(2));
    await store.flush();
    expect(store.size).toBe(0);
  });

  test("lazily prunes an expired entry on read", async () => {
    const store = new MemoryStore();
    await store.set("k", makeEntry("v", -1000)); // already expired
    expect(await store.get("k")).toBeNull();
    expect(store.size).toBe(0);
  });

  test("size reflects live entries", async () => {
    const store = new MemoryStore();
    await store.set("a", makeEntry(1));
    await store.set("b", makeEntry(2));
    expect(store.size).toBe(2);
  });
});

describe("makeEntry / isFresh", () => {
  test("makeEntry with no TTL has expiresAt 0 and never expires", () => {
    const e = makeEntry("v");
    expect(e.value).toBe("v");
    expect(e.expiresAt).toBe(0);
    expect(e.hitCount).toBe(0);
    expect(e.createdAt).toBeGreaterThan(0);
    expect(isFresh(e)).toBe(true);
  });

  test("makeEntry with a TTL sets a future expiry", () => {
    const e = makeEntry("v", 1000);
    expect(e.expiresAt - e.createdAt).toBeGreaterThan(900);
    expect(isFresh(e)).toBe(true);
  });

  test("an entry past its expiry is not fresh", () => {
    expect(isFresh(makeEntry("v", -1000))).toBe(false);
  });
});
