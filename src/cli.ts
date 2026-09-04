#!/usr/bin/env bun
/**
 * Command-line interface for redis-cache-wrapper.
 *
 * Uses an in-memory store by default (no Redis required) so the CLI is
 * instantly usable and testable. Pass `--redis-url` to target a real Redis.
 *
 * Examples:
 *   bun run src/cli.ts set user:42 '{"name":"Ada"}' 60
 *   bun run src/cli.ts get user:42
 *   bun run src/cli.ts del user:42
 *   bun run src/cli.ts flush
 *   bun run src/cli.ts status
 */

import { Command } from "commander";
import Redis from "ioredis";
import { RedisCacheWrapper } from "./cache";
import { MemoryStore, RedisStore } from "./store";

async function buildWrapper(redisUrl?: string): Promise<{
  cache: RedisCacheWrapper;
  close: () => Promise<void>;
}> {
  if (redisUrl) {
    const client = new Redis(redisUrl, { lazyConnect: true });
    await client.connect();
    return {
      cache: new RedisCacheWrapper(new RedisStore(client)),
      close: async () => {
        await client.quit();
      },
    };
  }
  return {
    cache: new RedisCacheWrapper(new MemoryStore()),
    close: async () => {},
  };
}

const program = new Command();

program
  .name("redis-cache-wrapper")
  .description("Redis caching layer for API responses")
  .version("1.0.0")
  .option("-r, --redis-url <url>", "Redis connection string (e.g. redis://localhost:6379)");

program
  .command("set <key> <value> [ttlSeconds]")
  .description("Store a value (JSON or plain string) with an optional TTL in seconds")
  .action(async (key: string, value: string, ttlSeconds?: string, opts?: any) => {
    const { cache, close } = await buildWrapper(opts?.parent?.redisUrl);
    const ttl = ttlSeconds ? Number(ttlSeconds) * 1000 : undefined;
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      /* keep raw string */
    }
    await cache.set(key, parsed, ttl);
    console.log(`OK  set ${key}${ttl ? ` (ttl ${ttlSeconds}s)` : ""}`);
    await close();
  });

program
  .command("get <key>")
  .description("Read a value; prints null on miss")
  .action(async (key: string, opts?: any) => {
    const { cache, close } = await buildWrapper(opts?.parent?.redisUrl);
    const value = await cache.get<unknown>(key);
    console.log(JSON.stringify(value ?? null));
    await close();
  });

program
  .command("del <key>")
  .description("Remove a key; exits 0 if removed, 1 if absent")
  .action(async (key: string, opts?: any) => {
    const { cache, close } = await buildWrapper(opts?.parent?.redisUrl);
    const removed = await cache.delete(key);
    console.log(removed ? `OK  deleted ${key}` : `MISS ${key}`);
    process.exitCode = removed ? 0 : 1;
    await close();
  });

program
  .command("flush")
  .description("Remove every key in this cache")
  .action(async (opts?: any) => {
    const { cache, close } = await buildWrapper(opts?.parent?.redisUrl);
    await cache.flush();
    console.log("OK  cache flushed");
    await close();
  });

program
  .command("status")
  .description("Show cumulative cache statistics")
  .action(async (opts?: any) => {
    const { cache, close } = await buildWrapper(opts?.parent?.redisUrl);
    console.log(JSON.stringify(cache.getStats(), null, 2));
    await close();
  });

program.parse(process.argv);
