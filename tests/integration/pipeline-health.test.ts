/**
 * The queue health snapshot behind the backlog and failure alarms, against a
 * real Postgres. Other local rows may exist, so it checks lower bounds from
 * rows it creates in its own event. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendees, closePool, events, pipelineHealth, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { reportHealthIfDue } from "../../packages/db/workers/metrics.worker";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const ORG = `health-${RUN}`;

describeDb("pipeline health", () => {
  let eventId: string;
  let attendeeId: string;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany([{ name: "Health check", email: `health-${RUN}@example.com` }]);
    attendeeId = (await attendees.findByEmail(`health-${RUN}@example.com`))!.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'closed') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, [attendeeId]);
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email = $1`, [`health-${RUN}@example.com`]);
    await closePool();
  });

  it("reports how long due work has waited and what failed for good", async () => {
    await query(`insert into matching_jobs (event_id, participant_id, job_type, status, available_at, created_at)
                 values ($1, $2, 'embed', 'pending', now() - interval '20 minutes', now() - interval '20 minutes'),
                        ($1, $2, 'match', 'failed', now(), now())`, [eventId, attendeeId]);
    await query(`insert into notification_outbox (event_id, recipient_id, kind, subject_id, dedupe_key, status, available_at)
                 values ($1, $2, 'intro.requested', $2, $3, 'pending', now() - interval '15 minutes'),
                        ($1, $2, 'intro.accepted', $2, $4, 'failed', now())`,
    [eventId, attendeeId, `health-a-${RUN}`, `health-b-${RUN}`]);

    const health = await pipelineHealth.snapshot();
    expect(health.jobsPending).toBeGreaterThanOrEqual(1);
    expect(health.oldestDueJobSeconds).toBeGreaterThanOrEqual(20 * 60 - 5);
    expect(health.jobsFailed).toBeGreaterThanOrEqual(1);
    expect(health.oldestDueNotificationSeconds).toBeGreaterThanOrEqual(15 * 60 - 5);
    expect(health.notificationsFailed).toBeGreaterThanOrEqual(1);
  });

  it("reports at most once a minute, with a heartbeat", async () => {
    const metrics = { record: (values: Array<{ name: string }>) => recorded.push(values.map((value) => value.name)) };
    const recorded: string[][] = [];
    const now = Date.now() + 10 * 60_000;
    expect(await reportHealthIfDue(metrics, now)).toBe(true);
    expect(await reportHealthIfDue(metrics, now + 1000)).toBe(false);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual(expect.arrayContaining(["WorkerHeartbeat", "OldestDueJobSeconds", "NotificationsFailed"]));
  });
});
