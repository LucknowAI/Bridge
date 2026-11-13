/**
 * Retrieval must not starve someone whose nearest neighbours all have
 * intents they do not welcome: a mentor among many mentors still finds the
 * one person seeking a mentor. Real Postgres, fake embeddings, own event.
 * Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendees, closePool, events, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresParticipantRepository } from "../../apps/web/src/infrastructure/postgres/participant.repo";
import { PostgresMatchRepository } from "../../apps/web/src/infrastructure/postgres/match.repo";
import { PostgresCandidateCache } from "../../apps/web/src/infrastructure/cache/postgres-candidate-cache";
import { MatchingPipeline } from "../../apps/web/src/domain/matching/pipeline";
import { Intent } from "../../apps/web/src/domain/participant/intent";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const ORG = `recall-${RUN}`;
const MENTORS = 55;
const email = (key: string) => `recall-${key}-${RUN}@example.com`;
const VECTOR = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
const embeddings = { id: "test:recall", embed: async () => VECTOR };

describeDb("retrieval recall", () => {
  const participants = new PostgresParticipantRepository();
  const pipeline = new MatchingPipeline(participants, new PostgresMatchRepository(), embeddings, null, new PostgresCandidateCache(), null);
  const ids: Record<string, string> = {};
  let eventId: string;

  beforeAll(async () => {
    await migrate();
    const keys = ["viewer", "seeker", ...Array.from({ length: MENTORS }, (_, i) => `mentor${i}`)];
    await attendees.upsertMany(keys.map((key) => ({ name: `Recall ${key}`, email: email(key) })));
    const { rows } = await query<{ id: string; email: string }>(`select id, email from registered_attendees where email like $1`, [`recall-%-${RUN}@example.com`]);
    for (const row of rows) ids[row.email.split("-")[1]] = row.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, Object.values(ids));
    for (const key of keys) {
      await participants.saveProfile({
        eventId, attendeeId: ids[key], designation: "Engineer", domain: "AI", aboutMe: key === "seeker" ? "New to the field" : "Mentors engineers",
        selfDescription: null, yearsOfExperience: null, mostImpressiveBuild: null,
        intent: key === "seeker" ? Intent.SEEKING_MENTOR : Intent.MENTORING, interests: [], venueZone: null,
      });
      // Every mentor sits right next to the viewer; the seeker has no vector at all.
      if (key.startsWith("mentor")) await participants.setEmbedding(eventId, ids[key], VECTOR, embeddings.id);
    }
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email like $1`, [`recall-%-${RUN}@example.com`]);
    await closePool();
  });

  it("finds the only compatible person beyond the nearest neighbours", async () => {
    const ranked = await pipeline.run({ eventId, participantId: ids.viewer, mode: "profile" });
    expect(ranked.map((candidate) => candidate.participant.attendeeId)).toEqual([ids.seeker]);
  });

  it("does the same for search", async () => {
    const ranked = await pipeline.run({ eventId, participantId: ids.viewer, mode: "search", query: "mentors engineers" });
    expect(ranked.map((candidate) => candidate.participant.attendeeId)).toContain(ids.seeker);
  });
});
