import { describe, test, expect } from "bun:test";
describe("redis-cache-wrapper", () => {
  test("module loads", async () => { const m = await import("./index"); expect(m).toBeDefined(); });
});
