/**
 * Invitation lifecycle against a real Postgres: who gets invited, claims,
 * and what removing access takes away. Uses its own organization, event and
 * attendees. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, closePool, attendees, events } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresParticipantRepository } from "../../apps/web/src/infrastructure/postgres/participant.repo";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const ORG = "integration-invitations";
const KEYS = ["new", "invited", "claimed", "removed", "viewer"] as const;
const emailOf = (key: string) => `invite-${key}@example.com`;

describeDb("invitation lifecycle", () => {
  const participants = new PostgresParticipantRepository();
  let eventId: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(KEYS.map((key) => ({ name: `Invite ${key}`, email: emailOf(key) })));
    const found = await attendees.findIdsByEmails(KEYS.map(emailOf));
    ids = Object.fromEntries(KEYS.map((key) => [key, found.find((row) => row.email === emailOf(key))!.id]));
    const { rows: [org] } = await query<{ id: string }>(
      `insert into organizations (name, slug) values ('Invitations', $1)
       on conflict (slug) do update set name = excluded.name returning id`, [ORG]);
    const { rows: [event] } = await query<{ id: string }>(
      `insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open')
       on conflict (organization_id, slug) do update set status = 'open' returning id`, [org.id, ORG]);
    eventId = event.id;
    await query(`delete from event_participants where event_id = $1`, [eventId]);
    await events.attachRoster(eventId, Object.values(ids));
    await query(
      `update event_participants set profile_updated_at = now(), designation = 'Engineer', domain = 'AI', about_me = 'Builds things'
        where event_id = $1 and attendee_id = any($2::uuid[])`, [eventId, [ids.removed, ids.viewer]]);
    await query(`update event_participants set invited_at = now() - interval '2 minutes', invite_count = 1 where event_id = $1 and attendee_id = $2`, [eventId, ids.invited]);
    await events.markClaimed(eventId, ids.claimed);
    await events.setRevoked(eventId, ids.removed, true);
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email = any($1::text[])`, [KEYS.map(emailOf)]);
    await closePool();
  });

  it("invites only people never invited, never claimed and not removed", async () => {
    const targets = await events.invitationTargets(eventId, null, 10);
    expect(targets.map((target) => target.email).sort()).toEqual([emailOf("new"), emailOf("viewer")]);
  });

  it("throttles a resend to the same person", async () => {
    expect(await events.invitationTargets(eventId, ids.invited, 10)).toEqual([]);
    expect(await events.invitationTargets(eventId, ids.invited, 1)).toHaveLength(1);
    expect(await events.invitationTargets(eventId, ids.claimed, 0)).toEqual([]);
  });

  it("records a failure without pretending the e-mail went out", async () => {
    await events.recordInvitation(eventId, ids.new, "Resend rejected the address");
    await events.recordInvitation(eventId, ids.invited, null);
    const rows = await events.roster(eventId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ids.new)).toMatchObject({ invited_at: null, invite_count: 0, invite_error: "Resend rejected the address" });
    expect(byId.get(ids.invited)).toMatchObject({ invite_count: 2, invite_error: null });
  });

  it("keeps the first claim time", async () => {
    const before = (await events.roster(eventId)).find((row) => row.id === ids.claimed)!.claimed_at;
    await events.markClaimed(eventId, ids.claimed);
    expect((await events.roster(eventId)).find((row) => row.id === ids.claimed)!.claimed_at).toEqual(before);
  });

  it("removes every kind of access from a revoked attendee", async () => {
    expect(await events.isParticipant(eventId, ids.removed)).toBe(false);
    expect(await participants.hasEventAccess(eventId, ids.removed)).toBe(false);
    expect(await events.participantIds(eventId)).not.toContain(ids.removed);
    expect(await events.rosterState(eventId, ids.removed)).toBe("revoked");
    const candidates = await participants.findCandidatesByIds(eventId, [ids.removed, ids.viewer]);
    expect(candidates.map((candidate) => candidate.attendeeId)).toEqual([ids.viewer]);
  });

  it("restores access explicitly, and re-importing does not do it silently", async () => {
    await events.attachRoster(eventId, [ids.removed]);
    expect(await events.rosterState(eventId, ids.removed)).toBe("revoked");
    await events.setRevoked(eventId, ids.removed, false);
    expect(await participants.hasEventAccess(eventId, ids.removed)).toBe(true);
  });
});
