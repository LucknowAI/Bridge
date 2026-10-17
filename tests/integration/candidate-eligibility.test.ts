/**
 * Hidden, incomplete, removed, and other-event participants must not appear
 * through any results path: fresh retrieval, cached search ids, or saved
 * matches. Runs against a real Postgres and is skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, closePool, attendees } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresParticipantRepository } from "../../apps/web/src/infrastructure/postgres/participant.repo";
import { PostgresMatchRepository } from "../../apps/web/src/infrastructure/postgres/match.repo";
import { RetrieveStage } from "../../apps/web/src/domain/matching/stages/retrieve.stage";
import { Intent } from "../../apps/web/src/domain/participant/intent";
import type { MatchCandidate } from "../../apps/web/src/domain/matching/match-strategy";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

const ORG_SLUG = "integration-eligibility";
const KEYS = ["viewer", "eligible", "hidden", "incomplete", "removed", "other"] as const;
type Key = (typeof KEYS)[number];
const emailOf = (key: Key) => `eligibility-${key}@example.com`;

describeDb("candidate eligibility", () => {
  const participants = new PostgresParticipantRepository();
  const matches = new PostgresMatchRepository();
  let eventId: string;
  let otherEventId: string;
  let ids: Record<Key, string>;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(KEYS.map((key) => ({ name: key, email: emailOf(key) })));
    const found = await attendees.findIdsByEmails(KEYS.map(emailOf));
    ids = Object.fromEntries(KEYS.map((key) => [key, found.find((row) => row.email === emailOf(key))!.id])) as Record<Key, string>;

    const { rows: [org] } = await query<{ id: string }>(
      `insert into organizations (name, slug) values ('Eligibility test', $1)
       on conflict (slug) do update set name = excluded.name returning id`, [ORG_SLUG]
    );
    const event = async (slug: string) => (await query<{ id: string }>(
      `insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open')
       on conflict (organization_id, slug) do update set status = 'open' returning id`, [org.id, slug]
    )).rows[0].id;
    eventId = await event(ORG_SLUG);
    otherEventId = await event(`${ORG_SLUG}-other`);

    const join = (event: string, key: Key, saved: boolean, visible = true) => query(
      `insert into event_participants (event_id, attendee_id, visible, profile_updated_at)
       values ($1, $2, $3, case when $4 then now() end)
       on conflict (event_id, attendee_id) do update
         set visible = excluded.visible, profile_updated_at = excluded.profile_updated_at`,
      [event, ids[key], visible, saved]
    );
    await join(eventId, "viewer", true);
    await join(eventId, "eligible", true);
    await join(eventId, "hidden", true, false);
    await join(eventId, "incomplete", false);
    await join(eventId, "removed", true);
    await join(otherEventId, "other", true);

    // Saved before "removed" left the roster; "hidden"/"incomplete" changed after matching.
    await matches.save(eventId, ids.viewer,
      (["hidden", "eligible", "incomplete", "removed"] as const).map((key) => candidate(key)), "v1+score");
    await query(`delete from event_participants where event_id = $1 and attendee_id = $2`, [eventId, ids.removed]);
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG_SLUG]);
    await query(`delete from registered_attendees where email = any($1::text[])`, [KEYS.map(emailOf)]);
    await closePool();
  });

  function candidate(key: Key): MatchCandidate {
    return {
      participant: {
        eventId, attendeeId: ids[key], name: key, designation: null, domain: null, aboutMe: null,
        selfDescription: null, yearsOfExperience: null, mostImpressiveBuild: null,
        intent: Intent.NETWORKING, interests: [], venueZone: null, visible: true,
      },
      score: 50, scoreBreakdown: {}, mutualInterest: false, reason: `Reason for ${key}`,
    };
  }
  const keysOf = (rows: Array<{ attendeeId: string }>) =>
    rows.map((row) => KEYS.find((key) => ids[key] === row.attendeeId) ?? row.attendeeId);

  it("returns only eligible candidates from fresh retrieval", async () => {
    const rows = await participants.listCandidates({ eventId, excludeAttendeeId: ids.viewer });
    expect(keysOf(rows)).toEqual(["eligible"]);
  });

  it("re-checks eligibility when hydrating cached ids", async () => {
    const allIds = KEYS.map((key) => ids[key]);
    expect(keysOf(await participants.findCandidatesByIds(eventId, allIds)).sort()).toEqual(["eligible", "viewer"]);

    // A cache entry written before people became ineligible still yields only current candidates.
    const cache = { get: async () => allIds, set: async () => {} };
    const retrieved = await new RetrieveStage(participants, cache)
      .execute({ eventId, viewerId: ids.viewer, embedding: null, query: "anything" });
    expect(keysOf(retrieved)).toEqual(["eligible"]);
  });

  it("filters saved matches that are no longer eligible", async () => {
    const saved = await matches.listForParticipant(eventId, ids.viewer);
    expect(keysOf(saved.map((match) => match.participant))).toEqual(["eligible"]);
  });

  it("keeps a hidden viewer's own matches readable", async () => {
    await query(`update event_participants set visible = false where event_id = $1 and attendee_id = $2`, [eventId, ids.viewer]);
    const saved = await matches.listForParticipant(eventId, ids.viewer);
    expect(keysOf(saved.map((match) => match.participant))).toEqual(["eligible"]);
  });
});
