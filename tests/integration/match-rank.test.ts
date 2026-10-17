/**
 * Saved matches must come back in the order they were saved (the reranked
 * order), not re-sorted by numeric score. Runs against a real Postgres and is
 * skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, closePool, attendees } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresMatchRepository } from "../../apps/web/src/infrastructure/postgres/match.repo";
import { Intent } from "../../apps/web/src/domain/participant/intent";
import type { MatchCandidate } from "../../apps/web/src/domain/matching/match-strategy";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

const ORG_SLUG = "integration-match-rank";
const EMAILS = ["rank-viewer@example.com", "rank-a@example.com", "rank-b@example.com", "rank-c@example.com"];

describeDb("persisted match order", () => {
  const repo = new PostgresMatchRepository();
  let eventId: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(EMAILS.map((email) => ({ name: email.split("@")[0], email })));
    const found = await attendees.findIdsByEmails(EMAILS);
    ids = Object.fromEntries(found.map((row) => [row.email.split("@")[0].replace("rank-", ""), row.id]));
    const { rows: [org] } = await query<{ id: string }>(
      `insert into organizations (name, slug) values ('Rank test', $1)
       on conflict (slug) do update set name = excluded.name returning id`, [ORG_SLUG]
    );
    const { rows: [event] } = await query<{ id: string }>(
      `insert into events (organization_id, name, slug, status) values ($1, 'Rank test', $2, 'open')
       on conflict (organization_id, slug) do update set status = 'open' returning id`, [org.id, ORG_SLUG]
    );
    eventId = event.id;
    for (const id of Object.values(ids)) {
      await query(`insert into event_participants (event_id, attendee_id) values ($1, $2) on conflict do nothing`, [eventId, id]);
    }
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG_SLUG]);
    await query(`delete from registered_attendees where email = any($1::text[])`, [EMAILS]);
    await closePool();
  });

  const candidate = (key: string, score: number): MatchCandidate => ({
    participant: {
      eventId, attendeeId: ids[key], name: key, designation: null, domain: null, aboutMe: null,
      selfDescription: null, yearsOfExperience: null, mostImpressiveBuild: null,
      intent: Intent.NETWORKING, interests: [], venueZone: null, visible: true,
    },
    score,
    scoreBreakdown: { domain: score / 100 },
    mutualInterest: false,
    reason: `Reason for ${key}`,
  });
  // Map stored attendee ids back to the short keys used in each test.
  const names = (rows: MatchCandidate[]) =>
    rows.map((row) => Object.keys(ids).find((key) => ids[key] === row.participant.attendeeId));

  it("reads back the reranked order even when it contradicts the scores", async () => {
    // The model put the lowest score first; score order would be b, c, a.
    await repo.save(eventId, ids.viewer, [candidate("a", 40), candidate("b", 90), candidate("c", 65)], "v1+llm:test");
    const saved = await repo.listForParticipant(eventId, ids.viewer);
    expect(names(saved)).toEqual(["a", "b", "c"]);
    expect(saved.map((row) => row.score)).toEqual([40, 90, 65]);
    expect(saved[0]).toMatchObject({ reason: "Reason for a", scoreBreakdown: { domain: 0.4 } });

    const { rows } = await query<{ rank: number; computation_version: string }>(
      `select rank, computation_version from event_matches where event_id = $1 and participant_id = $2 order by rank`,
      [eventId, ids.viewer]
    );
    expect(rows).toEqual([1, 2, 3].map((rank) => ({ rank, computation_version: "v1+llm:test" })));
  });

  it("replaces the previous list with the new order", async () => {
    await repo.save(eventId, ids.viewer, [candidate("c", 65), candidate("a", 40)], "v1+score");
    expect(names(await repo.listForParticipant(eventId, ids.viewer))).toEqual(["c", "a"]);
  });

  it("clears the list when nothing matches", async () => {
    await repo.save(eventId, ids.viewer, [], "v1+score");
    expect(await repo.listForParticipant(eventId, ids.viewer)).toEqual([]);
  });
});
