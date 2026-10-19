/**
 * Event isolation in one place, against a real Postgres: two organizations
 * each run an event, and one person attends both. Nothing read or changed
 * through one event may reach the other, even with ids taken from it.
 * Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendees, closePool, events, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresIntroRepository } from "../../apps/web/src/infrastructure/postgres/intro.repo";
import { PostgresLocationRepository } from "../../apps/web/src/infrastructure/postgres/location.repo";
import { PostgresParticipantRepository } from "../../apps/web/src/infrastructure/postgres/participant.repo";
import { PostgresMatchRepository } from "../../apps/web/src/infrastructure/postgres/match.repo";
import { requestIntro } from "../../apps/web/src/application/use-cases/request-intro";
import { Intent } from "../../apps/web/src/domain/participant/intent";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const email = (key: string) => `tenant-${key}-${RUN}@example.com`;

describeDb("event isolation", () => {
  const intros = new PostgresIntroRepository();
  const locations = new PostgresLocationRepository();
  const participants = new PostgresParticipantRepository();
  const matches = new PostgresMatchRepository();
  const ids: Record<string, string> = {};
  const event: Record<"a" | "b", string> = { a: "", b: "" };
  let introA: string;
  let locationA: string;

  const profile = (eventId: string, key: string, aboutMe: string) => participants.saveProfile({
    eventId, attendeeId: ids[key], designation: "Engineer", domain: "AI", aboutMe, selfDescription: null,
    yearsOfExperience: null, mostImpressiveBuild: null, intent: Intent.NETWORKING, interests: [], venueZone: null,
  });

  beforeAll(async () => {
    await migrate();
    // ann and bo attend A, cy attends B, sam attends both.
    await attendees.upsertMany(["ann", "bo", "cy", "sam"].map((key) => ({ name: `Tenant ${key}`, email: email(key), phone: `+1555${RUN.slice(-4)}${key.length}${key.charCodeAt(0)}` })));
    for (const key of ["ann", "bo", "cy", "sam"]) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    for (const side of ["a", "b"] as const) {
      const slug = `tenant-${side}-${RUN}`;
      const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [slug]);
      event[side] = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, slug])).rows[0].id;
    }
    await events.attachRoster(event.a, [ids.ann, ids.bo, ids.sam]);
    await events.attachRoster(event.b, [ids.cy, ids.sam]);
    for (const key of ["ann", "bo", "sam"]) await profile(event.a, key, `Event A profile of ${key}`);
    for (const key of ["cy", "sam"]) await profile(event.b, key, `Event B profile of ${key}`);

    introA = (await intros.create({ eventId: event.a, requesterId: ids.ann, recipientId: ids.sam })).id;
    await intros.respond(event.a, introA, ids.sam, "accepted");
    locationA = (await locations.create({ eventId: event.a, introId: introA, requesterId: ids.ann, recipientId: ids.sam }))!.id;
    await matches.save(event.a, ids.ann, [{ participant: (await participants.findProfile(event.a, ids.sam))!, score: 0.9, scoreBreakdown: {}, mutualInterest: true, reason: "A only" }], "test");
  });

  afterAll(async () => {
    await query(`delete from organizations where slug like $1`, [`tenant-_-${RUN}`]);
    await query(`delete from registered_attendees where email like $1`, [`tenant-%-${RUN}@example.com`]);
    await closePool();
  });

  it("knows who belongs to which event", async () => {
    expect(await participants.hasEventAccess(event.b, ids.ann)).toBe(false);
    expect(await participants.hasEventAccess(event.b, ids.sam)).toBe(true);
    expect(await participants.findProfile(event.b, ids.ann)).toBeNull();
    expect((await participants.findProfile(event.b, ids.sam))!.aboutMe).toBe("Event B profile of sam");
  });

  it("retrieves candidates and stored matches from one event only", async () => {
    const inB = await participants.listCandidates({ eventId: event.b, excludeAttendeeId: ids.sam, terms: ["profile"] });
    expect(inB.map((candidate) => candidate.attendeeId)).toEqual([ids.cy]);
    expect(await matches.listForParticipant(event.b, ids.ann)).toEqual([]);
    expect((await matches.listForParticipant(event.a, ids.ann))[0].participant.aboutMe).toBe("Event A profile of sam");
  });

  it("refuses intros to someone from another event", async () => {
    await expect(requestIntro({ eventId: event.b, requesterId: ids.sam, recipientId: ids.ann }, { participants, intros })).rejects.toThrow(/not in the event/);
    await expect(requestIntro({ eventId: event.a, requesterId: ids.ann, recipientId: ids.cy }, { participants, intros })).rejects.toThrow(/not in the event/);
  });

  it("never reads or answers one event's intro through another", async () => {
    expect(await intros.findById(event.b, introA)).toBeNull();
    await expect(intros.respond(event.b, introA, ids.sam, "declined")).rejects.toThrow();
    expect(await intros.listForParticipant(event.b, ids.sam)).toEqual([]);
    expect(await intros.getRevealedContacts(event.b, ids.sam)).toEqual([]);
    expect((await intros.findById(event.a, introA))!.status).toBe("accepted");
  });

  it("keeps location requests inside their event", async () => {
    expect(await locations.forParticipant(event.b, ids.sam)).toEqual([]);
    expect(await locations.answer({ eventId: event.b, requestId: locationA, recipientId: ids.sam, zone: "Cafe" })).toBe(false);
    expect(await locations.create({ eventId: event.b, introId: introA, requesterId: ids.ann, recipientId: ids.sam })).toBeNull();
    expect((await locations.forParticipant(event.a, ids.sam))[0]).toMatchObject({ status: "pending" });
  });

  it("removing someone from one event leaves their other event alone", async () => {
    await events.setRevoked(event.b, ids.sam, true);
    expect(await participants.hasEventAccess(event.b, ids.sam)).toBe(false);
    expect(await participants.hasEventAccess(event.a, ids.sam)).toBe(true);
    expect(await intros.getRevealedContacts(event.a, ids.ann)).toHaveLength(1);
  });
});
