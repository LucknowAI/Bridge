/**
 * The sweep removes only rows that can no longer be used. Rows are tagged
 * with test-only keys so the assertions ignore any other local data.
 * Skipped when DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, closePool, housekeeping } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

const EMAIL = "housekeeping-test@example.com";
const PREFIX = "test:housekeeping:";

describeDb("expired-row sweep", () => {
  beforeAll(async () => {
    await migrate();
    await cleanUp();
    const challenge = (label: string, expiresAt: string) => query(
      `insert into login_challenges (email, code_hash, token_hash, expires_at, ip_address)
       values ($1, 'hash', $2, now() + $3::interval, $4)`,
      [EMAIL, randomUUID(), expiresAt, label]
    );
    await challenge("expired-2-days", "-2 days");
    await challenge("expired-1-hour", "-1 hour");
    await challenge("live", "10 minutes");

    await query(
      `insert into rate_limit_buckets (bucket_key, window_started_at, count)
       values ($1, now() - interval '2 days', 3), ($2, now(), 1)`,
      [`${PREFIX}old`, `${PREFIX}fresh`]
    );
    await query(
      `insert into retrieval_cache (cache_key, candidate_ids, expires_at)
       values ($1, '[]', now() - interval '1 minute'), ($2, '[]', now() + interval '5 minutes')`,
      [`${PREFIX}expired`, `${PREFIX}live`]
    );
  });

  async function cleanUp() {
    await query(`delete from login_challenges where email = $1`, [EMAIL]);
    await query(`delete from rate_limit_buckets where bucket_key like $1`, [`${PREFIX}%`]);
    await query(`delete from retrieval_cache where cache_key like $1`, [`${PREFIX}%`]);
  }

  afterAll(async () => {
    await cleanUp();
    await closePool();
  });

  it("deletes dead rows and keeps live or recent ones", async () => {
    const result = await housekeeping.sweepExpired();
    expect(result.loginChallenges).toBeGreaterThanOrEqual(1);

    const challenges = await query<{ ip_address: string }>(
      `select ip_address from login_challenges where email = $1 order by ip_address`, [EMAIL]);
    expect(challenges.rows.map((row) => row.ip_address)).toEqual(["expired-1-hour", "live"]);

    const buckets = await query<{ bucket_key: string }>(
      `select bucket_key from rate_limit_buckets where bucket_key like $1`, [`${PREFIX}%`]);
    expect(buckets.rows.map((row) => row.bucket_key)).toEqual([`${PREFIX}fresh`]);

    const cache = await query<{ cache_key: string }>(
      `select cache_key from retrieval_cache where cache_key like $1`, [`${PREFIX}%`]);
    expect(cache.rows.map((row) => row.cache_key)).toEqual([`${PREFIX}live`]);
  });
});
