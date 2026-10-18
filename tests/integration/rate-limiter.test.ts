/**
 * The shared limiter backs search and the per-IP sign-in limits, so it runs
 * against a real Postgres here (unit tests mock it). Uses its own bucket keys.
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, closePool } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresRateLimiter } from "../../apps/web/src/infrastructure/cache/postgres-rate-limiter";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
const PREFIX = "test:rate-limiter:";

describeDb("PostgresRateLimiter", () => {
  const limiter = new PostgresRateLimiter();

  beforeAll(async () => {
    await migrate();
    await query(`delete from rate_limit_buckets where bucket_key like $1`, [`${PREFIX}%`]);
  });

  afterAll(async () => {
    await query(`delete from rate_limit_buckets where bucket_key like $1`, [`${PREFIX}%`]);
    await closePool();
  });

  it("allows up to the limit, then refuses", async () => {
    const key = `${PREFIX}sequential`;
    const allowed = [];
    for (let i = 0; i < 4; i++) allowed.push(await limiter.consume(key, 3, 60));
    expect(allowed).toEqual([true, true, true, false]);
  });

  it("holds the limit for simultaneous requests", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => limiter.consume(`${PREFIX}parallel`, 4, 60)));
    expect(results.filter(Boolean)).toHaveLength(4);
  });

  it("starts a new window once the old one has passed", async () => {
    const key = `${PREFIX}window`;
    await limiter.consume(key, 1, 60);
    expect(await limiter.consume(key, 1, 60)).toBe(false);
    await query(`update rate_limit_buckets set window_started_at = now() - interval '2 minutes' where bucket_key = $1`, [key]);
    expect(await limiter.consume(key, 1, 60)).toBe(true);
  });
});
