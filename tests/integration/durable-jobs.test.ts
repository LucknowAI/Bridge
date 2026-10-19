/**
 * Durable, revision-aware matching jobs against a real Postgres. Every claim
 * is scoped to this test's own event, so jobs of other local data are never
 * touched. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendees, closePool, events, matchingJobs, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresParticipantRepository } from "../../apps/web/src/infrastructure/postgres/participant.repo";
import { PostgresMatchRepository } from "../../apps/web/src/infrastructure/postgres/match.repo";
import { Intent } from "../../apps/web/src/domain/participant/intent";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const ORG = `jobs-${RUN}`;
const email = (key: string) => `jobs-${key}-${RUN}@example.com`;

describeDb("durable matching jobs", () => {
  const participants = new PostgresParticipantRepository();
  const matches = new PostgresMatchRepository();
  const ids: Record<string, string> = {};
  let eventId: string;

  const save = (key: string, aboutMe: string) => participants.saveProfile({
    eventId, attendeeId: ids[key], designation: "Engineer", domain: "AI", aboutMe, selfDescription: null,
    yearsOfExperience: null, mostImpressiveBuild: null, intent: Intent.NETWORKING, interests: [], venueZone: null,
  });
  const jobsOf = async (key: string) => (await query<{ id: number; job_type: string; status: string; revision: string; attempts: number; last_error: string | null }>(
    `select id::int, job_type, status, revision, attempts, last_error from matching_jobs where event_id = $1 and participant_id = $2 order by id`,
    [eventId, ids[key]])).rows;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(["ann", "bo", "cy"].map((key) => ({ name: `Jobs ${key}`, email: email(key) })));
    for (const key of ["ann", "bo", "cy"]) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, Object.values(ids));
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email like $1`, [`jobs-%-${RUN}@example.com`]);
    await closePool();
  });

  it("queues the embedding with the save, and keeps one pending job through rapid edits", async () => {
    const first = await save("ann", "First version");
    expect(first.revision).toBe(1);
    await save("ann", "Second version");
    const jobs = await jobsOf("ann");
    expect(jobs).toEqual([expect.objectContaining({ job_type: "embed", status: "pending", revision: "2" })]);
  });

  it("queues an edit made while a job runs instead of dropping it", async () => {
    const running = await matchingJobs.claim("embed", eventId);
    expect(running).toMatchObject({ participant_id: ids.ann, revision: 2 });
    await save("ann", "Third version");
    const jobs = await jobsOf("ann");
    expect(jobs.map((job) => `${job.status}:${job.revision}`)).toEqual(["running:2", "pending:3"]);
    // The running job's embedding is now stale and refused.
    expect(await participants.setEmbeddingAt(eventId, ids.ann, new Array(768).fill(0.01), 2)).toBe(false);
    expect(await participants.setEmbeddingAt(eventId, ids.ann, new Array(768).fill(0.01), 3)).toBe(true);
    await matchingJobs.complete(running!.id);
  });

  it("refuses to publish matches computed for an older revision", async () => {
    await save("bo", "Bo's profile");
    const candidate = { participant: (await participants.findProfile(eventId, ids.ann))!, score: 70, scoreBreakdown: {}, mutualInterest: false, reason: "r" };
    expect(await matches.save(eventId, ids.bo, [candidate], "test", 0)).toBe(false);
    expect(await matches.save(eventId, ids.bo, [candidate], "test", 1)).toBe(true);
    expect(await matches.listForParticipant(eventId, ids.bo)).toHaveLength(1);
  });

  it("retries with a growing delay, then fails for good with the error kept", async () => {
    await query(`update matching_jobs set status = 'done' where event_id = $1 and status = 'pending'`, [eventId]);
    await save("cy", "Cy's profile");
    for (let attempt = 1; attempt <= 5; attempt++) {
      await query(`update matching_jobs set available_at = now() where event_id = $1 and participant_id = $2 and status = 'pending'`, [eventId, ids.cy]);
      const job = await matchingJobs.claim("embed", eventId);
      expect(job).toMatchObject({ participant_id: ids.cy, attempts: attempt });
      await matchingJobs.fail(job!.id, `boom ${attempt}`);
      const [row] = await jobsOf("cy");
      expect(row.status).toBe(attempt < 5 ? "pending" : "failed");
      expect(row.last_error).toBe(`boom ${attempt}`);
    }
    expect(matchingJobs.retryDelaySeconds(1)).toBe(30);
    expect(matchingJobs.retryDelaySeconds(3)).toBe(120);
    expect(matchingJobs.retryDelaySeconds(10)).toBe(900);
    expect((await matchingJobs.listFailed()).some((job) => job.email === email("cy") && job.last_error === "boom 5")).toBe(true);
  });

  it("re-queues failed jobs on request", async () => {
    expect(await matchingJobs.retryFailed("all")).toBeGreaterThanOrEqual(1);
    expect((await jobsOf("cy")).some((job) => job.status === "pending" && job.attempts === 0)).toBe(true);
  });

  it("marks a failing job superseded when a newer one is already pending", async () => {
    await query(`update matching_jobs set available_at = now() where event_id = $1 and participant_id = $2 and status = 'pending'`, [eventId, ids.cy]);
    const job = await matchingJobs.claim("embed", eventId);
    await save("cy", "Cy edited again");
    await matchingJobs.fail(job!.id, "late failure");
    expect((await jobsOf("cy")).find((row) => row.id === job!.id)?.status).toBe("done");
  });

  it("refreshes the people a profile change affects, coalesced and without cascading", async () => {
    // ann lists bo; cy has no matches yet; dee's (one-slot) list is full without bo; eve never finished a profile.
    await attendees.upsertMany(["dee", "eve"].map((key) => ({ name: `Jobs ${key}`, email: email(key) })));
    for (const key of ["dee", "eve"]) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    await events.attachRoster(eventId, [ids.dee, ids.eve]);
    await save("dee", "Dee's profile");
    await query(`update matching_jobs set status = 'done' where event_id = $1 and status = 'pending'`, [eventId]);
    await query(`delete from event_matches where event_id = $1`, [eventId]);
    await query(`insert into event_matches (event_id, participant_id, candidate_id, rank, score, computation_version)
                 values ($1, $2, $3, 1, 50, 't'), ($1, $4, $5, 1, 50, 't')`, [eventId, ids.ann, ids.bo, ids.dee, ids.ann]);

    expect(await matchingJobs.enqueueRefreshes(eventId, ids.bo, { delaySeconds: 60, fullList: 1 })).toBe(2);
    await matchingJobs.enqueueRefreshes(eventId, ids.bo, { delaySeconds: 60, fullList: 1 });
    const pending = (await query<{ participant_id: string; trigger_kind: string }>(
      `select participant_id, trigger_kind from matching_jobs where event_id = $1 and status = 'pending'`, [eventId])).rows;
    expect(pending.map((row) => row.participant_id).sort()).toEqual([ids.ann, ids.cy].sort());
    expect(pending.every((row) => row.trigger_kind === "refresh")).toBe(true);
  });

  it("keeps a pending profile job a profile job when a refresh joins it", async () => {
    await save("ann", "Ann edits again");
    await matchingJobs.enqueue(eventId, ids.ann, "embed", { trigger: "refresh" });
    expect((await query<{ trigger_kind: string }>(`select trigger_kind from matching_jobs where event_id = $1 and participant_id = $2 and job_type = 'embed' and status = 'pending'`,
      [eventId, ids.ann])).rows[0].trigger_kind).toBe("profile");
  });

  it("fails a crashed job that was already on its last attempt", async () => {
    await query(`update matching_jobs set available_at = now() where event_id = $1 and status = 'pending'`, [eventId]);
    const job = await matchingJobs.claim("embed", eventId);
    await query(`update matching_jobs set attempts = 5, last_error = null, lease_until = now() - interval '1 minute' where id = $1`, [job!.id]);
    await matchingJobs.claim("embed", eventId);
    expect((await query<{ status: string; last_error: string }>(`select status, last_error from matching_jobs where id = $1`, [job!.id])).rows[0])
      .toEqual({ status: "failed", last_error: "worker stopped responding" });
  });
});
