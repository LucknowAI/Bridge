/**
 * Location requests against a real Postgres: one open request per direction,
 * replies visible only to the asker, expiry, and the notifications they
 * queue. Uses its own organization, event and people. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendees, closePool, events, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresIntroRepository } from "../../apps/web/src/infrastructure/postgres/intro.repo";
import { PostgresLocationRepository } from "../../apps/web/src/infrastructure/postgres/location.repo";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const ORG = `location-${RUN}`;
const email = (key: string) => `location-${key}-${RUN}@example.com`;

describeDb("location requests", () => {
  const intros = new PostgresIntroRepository();
  const locations = new PostgresLocationRepository();
  const ids: Record<string, string> = {};
  let eventId: string;
  let introId: string;
  let requestId: string;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(["amy", "ben", "cal"].map((key) => ({ name: `Location ${key}`, email: email(key) })));
    for (const key of ["amy", "ben", "cal"]) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, Object.values(ids));
    introId = (await intros.create({ eventId, requesterId: ids.amy, recipientId: ids.ben })).id;
    await intros.respond(eventId, introId, ids.ben, "accepted");
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email like $1`, [`location-%-${RUN}@example.com`]);
    await closePool();
  });

  it("opens one request per direction and queues a notification for it", async () => {
    requestId = (await locations.create({ eventId, introId, requesterId: ids.amy, recipientId: ids.ben }))!.id;
    expect(await locations.create({ eventId, introId, requesterId: ids.amy, recipientId: ids.ben })).toBeNull();
    const queued = await query(`select 1 from notification_outbox where kind = 'location.requested' and subject_id = $1 and recipient_id = $2`, [requestId, ids.ben]);
    expect(queued.rows).toHaveLength(1);
    expect((await locations.forParticipant(eventId, ids.ben))).toEqual([expect.objectContaining({ direction: "incoming", status: "pending", zone: null })]);
  });

  it("only the recipient can answer, and only the asker sees the zone", async () => {
    expect(await locations.answer({ eventId, requestId, recipientId: ids.cal, zone: "Cafe" })).toBe(false);
    expect(await locations.answer({ eventId, requestId, recipientId: ids.ben, zone: "Cafe" })).toBe(true);
    expect(await locations.forParticipant(eventId, ids.amy)).toEqual([expect.objectContaining({ direction: "outgoing", status: "answered", zone: "Cafe" })]);
    expect((await locations.forParticipant(eventId, ids.ben))[0]).toMatchObject({ direction: "incoming", zone: null });
    expect(await locations.forParticipant(eventId, ids.cal)).toEqual([]);
    expect((await query(`select 1 from notification_outbox where kind = 'location.answered' and recipient_id = $1`, [ids.amy])).rows).toHaveLength(1);
  });

  it("expires shared zones and unanswered requests, and lets a new request replace an expired one", async () => {
    await query(`update location_requests set zone_expires_at = now() - interval '1 minute' where id = $1`, [requestId]);
    expect((await locations.forParticipant(eventId, ids.amy))[0]).toMatchObject({ status: "expired", zone: null });

    const next = (await locations.create({ eventId, introId, requesterId: ids.amy, recipientId: ids.ben }))!;
    await query(`update location_requests set expires_at = now() - interval '1 minute' where id = $1`, [next.id]);
    expect(await locations.answer({ eventId, requestId: next.id, recipientId: ids.ben, zone: "Cafe" })).toBe(false);
    expect(await locations.create({ eventId, introId, requesterId: ids.amy, recipientId: ids.ben })).not.toBeNull();
  });

  it("records a decline without a zone", async () => {
    const open = (await locations.forParticipant(eventId, ids.ben)).find((request) => request.status === "pending")!;
    expect(await locations.answer({ eventId, requestId: open.id, recipientId: ids.ben, zone: null })).toBe(true);
    expect((await locations.forParticipant(eventId, ids.amy))[0]).toMatchObject({ status: "declined", zone: null });
  });
});
