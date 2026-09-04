import { describe, test, expect } from "bun:test";
import { RedisCacheWrapper, MemoryStore, RedisStore, makeEntry, isFresh } from "../src/index";

describe("public API", () => {
  test("exports the wrapper and both backends", () => {
    expect(typeof RedisCacheWrapper).toBe("function");
    expect(typeof MemoryStore).toBe("function");
    expect(typeof RedisStore).toBe("function");
  });

  test("exports entry helpers", () => {
    expect(typeof makeEntry).toBe("function");
    expect(typeof isFresh).toBe("function");
  });
});
