/**
 * The queue status reads the latest job per participant, scoped to one event.
 * Rows are inserted directly (no claim()), so jobs belonging to other local
 * data are never touched. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, closePool, attendees } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresMatchQueue } from "../../apps/web/src/infrastructure/postgres/match-queue.repo";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

const ORG_SLUG = "integration-match-queue";
const KEYS = ["a", "b", "c"] as const;
const emailOf = (key: string) => `queue-${key}@example.com`;

describeDb("match queue status", () => {
  const queue = new PostgresMatchQueue();
  let eventId: string;
  let otherEventId: string;
  let ids: Record<string, string>;

  async function job(event: string, key: string, type: string, status: string, minutesAgo: number, startedMinutesAgo?: number) {
    await query(
      `insert into matching_jobs (event_id, participant_id, job_type, status, created_at, started_at)
       values ($1, $2, $3, $4, now() - make_interval(mins => $5), case when $6::int is null then null else now() - make_interval(mins => $6::int) end)`,
      [event, ids[key], type, status, minutesAgo, startedMinutesAgo ?? null]
    );
  }

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(KEYS.map((key) => ({ name: key, email: emailOf(key) })));
    const found = await attendees.findIdsByEmails(KEYS.map(emailOf));
    ids = Object.fromEntries(KEYS.map((key) => [key, found.find((row) => row.email === emailOf(key))!.id]));
    const { rows: [org] } = await query<{ id: string }>(
      `insert into organizations (name, slug) values ('Queue test', $1)
       on conflict (slug) do update set name = excluded.name returning id`, [ORG_SLUG]
    );
    const event = async (slug: string) => (await query<{ id: string }>(
      `insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open')
       on conflict (organization_id, slug) do update set status = 'open' returning id`, [org.id, slug]
    )).rows[0].id;
    eventId = await event(ORG_SLUG);
    otherEventId = await event(`${ORG_SLUG}-other`);
    await query(`delete from matching_jobs where event_id = any($1::uuid[])`, [[eventId, otherEventId]]);

    // a: an old failure, then a newer match job finished.
    await job(eventId, "a", "match", "failed", 30);
    await job(eventId, "a", "match", "done", 5);
    // b: running for 20 minutes (stuck).
    await job(eventId, "b", "embed", "running", 25, 20);
    // c: only has jobs in another event.
    await job(otherEventId, "c", "match", "pending", 1);
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG_SLUG]);
    await query(`delete from registered_attendees where email = any($1::text[])`, [KEYS.map(emailOf)]);
    await closePool();
  });

  it("returns a participant's newest job", async () => {
    expect(await queue.latestJob(eventId, ids.a)).toEqual({ type: "match", status: "done", startedAt: null });
    const stuck = await queue.latestJob(eventId, ids.b);
    expect(stuck).toMatchObject({ type: "embed", status: "running" });
    expect(Date.now() - stuck!.startedAt!.getTime()).toBeGreaterThan(19 * 60_000);
  });

  it("keeps events apart", async () => {
    expect(await queue.latestJob(eventId, ids.c)).toBeNull();
    expect(await queue.latestJob(otherEventId, ids.c)).toMatchObject({ status: "pending" });
  });

  it("lists one latest job per participant in the event", async () => {
    const jobs = await queue.latestJobsForEvent(eventId);
    expect(jobs.map((row) => row.status).sort()).toEqual(["done", "running"]);
  });
});
