/**
 * The whole background journey against a real Postgres, driven by the real
 * worker functions: save → embed → match → stored list, refreshes for people
 * who saved earlier, the reranked order surviving storage, and recovery when
 * a worker dies between stages. Only the model providers are replaced, by
 * deterministic fakes. Work is scoped to this test's own event. Skipped
 * without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.MATCH_REFRESH_DELAY_SECONDS = "0";
});

vi.mock("../../apps/web/src/infrastructure/providers/provider-registry", () => {
  const DIMENSIONS = 768;
  // Bag of words hashed into a unit vector: similar texts, similar vectors.
  const embed = (text: string) => {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
      let hash = 0;
      for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % DIMENSIONS;
      vector[hash] += 1;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  };
  return {
    ProviderRegistry: {
      embedding: () => ({ id: "fake:bag-of-words", embed: async (text: string) => embed(text) }),
      // Reverses the scored order, so a stored list shows whose order won.
      llm: () => ({
        id: "fake:reverse",
        promptVersion: "test-1",
        rerank: async (_viewer: unknown, candidates: Array<{ participant: { name: string } }>) =>
          [...candidates].reverse().map((candidate) => ({ ...candidate, reason: `fake reason for ${candidate.participant.name}` })),
      }),
    },
  };
});

import { attendees, closePool, events, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { processEmbedJob } from "../../packages/db/workers/embed.worker";
import { processMatchJob } from "../../packages/db/workers/match.worker";
import { PostgresParticipantRepository } from "../../apps/web/src/infrastructure/postgres/participant.repo";
import { PostgresMatchRepository } from "../../apps/web/src/infrastructure/postgres/match.repo";
import { Intent } from "../../apps/web/src/domain/participant/intent";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const ORG = `pipeline-${RUN}`;
const email = (key: string) => `pipeline-${key}-${RUN}@example.com`;
const PEOPLE = {
  ann: "Builds graph databases in Rust and writes compilers",
  bo: "Builds graph databases in Rust",
  cy: "Writes compilers and graph tools",
  di: "Paints watercolor landscapes",
};
type Key = keyof typeof PEOPLE;

describeDb("matching pipeline end to end", () => {
  const participants = new PostgresParticipantRepository();
  const matches = new PostgresMatchRepository();
  const ids = {} as Record<Key, string>;
  let eventId: string;

  const save = (key: Key, aboutMe = PEOPLE[key]) => participants.saveProfile({
    eventId, attendeeId: ids[key], designation: "Engineer", domain: "Software", aboutMe, selfDescription: null,
    yearsOfExperience: null, mostImpressiveBuild: null, intent: Intent.NETWORKING, interests: [], venueZone: null,
  });
  const drain = async () => {
    for (let i = 0; i < 200; i++) {
      if (!(await processEmbedJob(eventId)) && !(await processMatchJob(eventId))) {
        const held = await query(`select 1 from matching_jobs where event_id = $1 and status = 'running' and lease_until > now()`, [eventId]);
        // Another worker on this database took a job, with real providers.
        if (held.rows.length) throw new Error("a separately running worker claimed this test's jobs; stop it and rerun");
        return;
      }
    }
    throw new Error("jobs never drained");
  };
  const listOf = async (key: Key) => (await matches.listForParticipant(eventId, ids[key])).map((candidate) => ({
    name: candidate.participant.name, score: candidate.score, reason: candidate.reason,
  }));
  const openJobs = async () => (await query(`select 1 from matching_jobs where event_id = $1 and status <> 'done'`, [eventId])).rows.length;
  const killWorkerHolding = async (type: "embed" | "match") => {
    const { rows } = await query<{ id: number }>(
      `update matching_jobs set status = 'running', attempts = attempts + 1, lease_until = now() - interval '1 second'
        where id = (select id from matching_jobs where event_id = $1 and job_type = $2 and status = 'pending' order by id limit 1)
        returning id::int`, [eventId, type]);
    expect(rows).toHaveLength(1);
  };

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany((Object.keys(PEOPLE) as Key[]).map((key) => ({ name: `Pipeline ${key}`, email: email(key) })));
    for (const key of Object.keys(PEOPLE) as Key[]) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, Object.values(ids));
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email like $1`, [`pipeline-%-${RUN}@example.com`]);
    await closePool();
  });

  it("gives the first person to save matches once others arrive", async () => {
    await save("ann");
    await drain();
    expect(await listOf("ann")).toEqual([]);
    for (const key of ["bo", "cy", "di"] as Key[]) await save(key);
    await drain();
    expect(await openJobs()).toBe(0);
    expect((await listOf("ann")).map((match) => match.name).sort()).toEqual(["Pipeline bo", "Pipeline cy", "Pipeline di"]);
  });

  it("stores the reranked order, not the score order, and keeps it through a refresh that changes nothing", async () => {
    const stored = await listOf("ann");
    const scores = stored.map((match) => match.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(scores[0]).toBeLessThan(scores[scores.length - 1]);
    expect(stored.every((match) => match.reason === `fake reason for ${match.name}`)).toBe(true);

    // A refresh with every explanation cached must not fall back to score order.
    await query(`insert into matching_jobs (event_id, participant_id, job_type, status, revision, trigger_kind)
                 select $1, $2, 'match', 'pending', profile_revision, 'refresh' from event_participants where event_id = $1 and attendee_id = $2`,
    [eventId, ids.ann]);
    await drain();
    expect(await listOf("ann")).toEqual(stored);
  });

  it("recovers when a worker dies holding the embedding, without publishing a stale revision", async () => {
    await save("ann", "Paints watercolor portraits");
    await killWorkerHolding("embed");
    const latest = await save("ann", "Paints watercolor landscapes and portraits");
    await drain();
    expect(await openJobs()).toBe(0);
    const { rows: [row] } = await query<{ profile_revision: string; embedded: boolean }>(
      `select profile_revision, embedding is not null as embedded from event_participants where event_id = $1 and attendee_id = $2`, [eventId, ids.ann]);
    expect(Number(row.profile_revision)).toBe(latest.revision);
    const { rows: done } = await query<{ revision: string }>(
      `select revision from matching_jobs where event_id = $1 and participant_id = $2 and job_type = 'match' order by id desc limit 1`, [eventId, ids.ann]);
    expect(Number(done[0].revision)).toBe(latest.revision);
    // di's watercolor profile is now the closest; the fake rerank puts it last.
    expect((await listOf("ann")).at(-1)?.name).toBe("Pipeline di");
  });

  it("recovers when a worker dies holding the match job", async () => {
    await save("bo", "Builds graph databases and query planners in Rust");
    await processEmbedJob(eventId);
    await killWorkerHolding("match");
    await drain();
    expect(await openJobs()).toBe(0);
    expect(await listOf("bo")).toHaveLength(3);
  });
});
