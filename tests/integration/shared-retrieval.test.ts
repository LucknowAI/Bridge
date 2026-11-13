/**
 * Shared search retrieval against a real Postgres: lock ownership, query
 * embedding reuse, and two pipeline instances (two "replicas") coalescing an
 * identical search while still ranking personally. Uses its own organization,
 * event and attendees. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { attendees, closePool, events, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresCandidateCache } from "../../apps/web/src/infrastructure/cache/postgres-candidate-cache";
import { PostgresParticipantRepository } from "../../apps/web/src/infrastructure/postgres/participant.repo";
import { MatchingPipeline } from "../../apps/web/src/domain/matching/pipeline";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const ORG = `shared-${RUN}`;
const email = (key: string) => `shared-${key}-${RUN}@example.com`;
const PEOPLE: Record<string, { domain: string; interests: string[] }> = {
  ana: { domain: "AI", interests: ["search"] },
  ben: { domain: "Design", interests: ["climate"] },
  cy: { domain: "AI", interests: ["search", "rag"] },
  dee: { domain: "Design", interests: ["climate", "ux"] },
};

describeDb("shared search retrieval", () => {
  const cache = new PostgresCandidateCache();
  const ids: Record<string, string> = {};
  let eventId: string;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(Object.keys(PEOPLE).map((key) => ({ name: `Shared ${key}`, email: email(key) })));
    for (const key of Object.keys(PEOPLE)) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, Object.values(ids));
    for (const [key, person] of Object.entries(PEOPLE)) {
      await query(`update event_participants set domain = $3, interests = $4, about_me = 'Builds products for people', designation = 'Builder', profile_updated_at = now()
                    where event_id = $1 and attendee_id = $2`, [eventId, ids[key], person.domain, person.interests]);
    }
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email like $1`, [`shared-%-${RUN}@example.com`]);
    await closePool();
  });

  it("gives a lock to one owner at a time, and only the owner releases it", async () => {
    const key = `test:${RUN}:lock`;
    const first = await cache.acquire(key, 5000);
    expect(first).toBeTruthy();
    expect(await cache.acquire(key, 5000)).toBeNull();
    await cache.release(key, "not-the-owner");
    expect(await cache.acquire(key, 5000)).toBeNull();
    await cache.release(key, first!);
    const second = await cache.acquire(key, 5000);
    expect(second).toBeTruthy();
    await cache.release(key, second!);
  });

  it("lets an expired lock be taken over", async () => {
    const key = `test:${RUN}:expired`;
    await cache.acquire(key, 5000);
    await query(`update cache_locks set expires_at = now() - interval '1 second' where lock_key = $1`, [key]);
    const token = await cache.acquire(key, 5000);
    expect(token).toBeTruthy();
    await cache.release(key, token!);
  });

  it("stores and reads query vectors", async () => {
    await cache.setVector(`test:${RUN}:vector`, [0.1, 0.2], 60);
    expect(await cache.getVector(`test:${RUN}:vector`)).toEqual([0.1, 0.2]);
  });

  /** A pipeline as one web replica would build it, counting retrievals. */
  function replica() {
    const participants = new PostgresParticipantRepository();
    const retrievals = vi.spyOn(participants, "listCandidates");
    const embeddings = { id: "none", embed: vi.fn(async () => null) };
    const matches = { save: vi.fn(), listForParticipant: vi.fn() };
    return { pipeline: new MatchingPipeline(participants, matches, embeddings, null, cache), retrievals };
  }
  const search = (pipeline: MatchingPipeline, viewer: string, text: string, domain: string | null = null) =>
    pipeline.run({ eventId, participantId: ids[viewer], mode: "search", query: text, filters: { intent: null, domain } })
      .then((ranked) => ranked.map((match) => match.participant.name));

  it("coalesces concurrent identical searches across replicas, but ranks personally", async () => {
    const one = replica();
    const two = replica();
    const [forAna, forBen] = await Promise.all([search(one.pipeline, "ana", "builds products"), search(two.pipeline, "ben", "builds products")]);
    expect(one.retrievals.mock.calls.length + two.retrievals.mock.calls.length).toBe(1);
    expect(forAna[0]).toBe("Shared cy");
    expect(forBen[0]).toBe("Shared dee");
  });

  it("retrieves again after the corpus changes or with a different filter", async () => {
    const { pipeline, retrievals } = replica();
    await search(pipeline, "ana", "builds products");
    expect(retrievals).not.toHaveBeenCalled();
    await query(`update event_participants set interests = '{search,agents}' where event_id = $1 and attendee_id = $2`, [eventId, ids.cy]);
    await search(pipeline, "ana", "builds products");
    expect(retrievals).toHaveBeenCalledTimes(1);
    await search(pipeline, "ana", "builds products", "AI");
    expect(retrievals).toHaveBeenCalledTimes(2);
  });
});
