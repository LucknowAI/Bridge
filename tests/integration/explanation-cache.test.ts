/**
 * The Postgres explanation cache: reads, overwrites, expiry, the housekeeping
 * sweep and deletion with the event. Uses its own organization and event.
 * Skipped when DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, housekeeping, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresExplanationCache } from "../../apps/web/src/infrastructure/cache/postgres-explanation-cache";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const ORG = `explain-${Date.now().toString(36)}`;

describeDb("Postgres explanation cache", () => {
  const cache = new PostgresExplanationCache();
  let eventId: string;
  const viewerId = randomUUID();
  const candidateId = randomUUID();
  const entry = (key: string, reason: string) => ({ key: `${ORG}:${key}`, eventId, viewerId, candidateId, reason });

  beforeAll(async () => {
    await migrate();
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug) values ($1, $2, $2) returning id`, [org.id, ORG])).rows[0].id;
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await closePool();
  });

  it("returns stored reasons and overwrites on a second write", async () => {
    await cache.setMany([entry("one", "First reason"), entry("two", "Second reason")], 60);
    await cache.setMany([entry("one", "Updated reason")], 60);
    const found = await cache.getMany([`${ORG}:one`, `${ORG}:two`, `${ORG}:missing`]);
    expect(Object.fromEntries(found)).toEqual({ [`${ORG}:one`]: "Updated reason", [`${ORG}:two`]: "Second reason" });
  });

  it("ignores expired entries and the sweep removes them", async () => {
    await cache.setMany([entry("old", "Old reason")], 60);
    await query(`update pair_explanations set expires_at = now() - interval '1 minute' where cache_key = $1`, [`${ORG}:old`]);
    expect((await cache.getMany([`${ORG}:old`])).size).toBe(0);
    await housekeeping.sweepExpired();
    expect((await query(`select 1 from pair_explanations where cache_key = $1`, [`${ORG}:old`])).rows).toHaveLength(0);
  });

  it("is deleted with its event", async () => {
    await query(`delete from events where id = $1`, [eventId]);
    expect((await cache.getMany([`${ORG}:one`, `${ORG}:two`])).size).toBe(0);
  });
});
