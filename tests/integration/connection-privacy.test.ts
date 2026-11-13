/**
 * Connection privacy against a real Postgres: a declined request stays
 * declined, and an attendee removed from the event disappears from other
 * people's connections and contacts. Uses its own organization, event and
 * attendees. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendees, closePool, events, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresIntroRepository } from "../../apps/web/src/infrastructure/postgres/intro.repo";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const ORG = `privacy-${RUN}`;
const email = (key: string) => `privacy-${key}-${RUN}@example.com`;

describeDb("connection privacy", () => {
  const intros = new PostgresIntroRepository();
  const ids: Record<string, string> = {};
  let eventId: string;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(["ann", "bo", "cy"].map((key) => ({ name: key, email: email(key), phone: null })));
    for (const key of ["ann", "bo", "cy"]) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, Object.values(ids));
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email like $1`, [`privacy-%-${RUN}@example.com`]);
    await closePool();
  });

  it("keeps a declined request declined", async () => {
    const declined = await intros.create({ eventId, requesterId: ids.ann, recipientId: ids.bo });
    await intros.respond(eventId, declined.id, ids.bo, "declined");
    await expect(intros.create({ eventId, requesterId: ids.ann, recipientId: ids.bo })).rejects.toThrow(/declined an earlier request/);
    expect((await intros.findById(eventId, declined.id))?.status).toBe("declined");
    expect(await intros.findBetween(eventId, ids.bo, ids.ann)).toHaveLength(1);
  });

  it("counts pending outgoing requests", async () => {
    await intros.create({ eventId, requesterId: ids.cy, recipientId: ids.bo });
    expect(await intros.countPendingOutgoing(eventId, ids.cy)).toBe(1);
  });

  it("hides a removed attendee from connections and contacts", async () => {
    const accepted = await intros.create({ eventId, requesterId: ids.ann, recipientId: ids.cy });
    await intros.respond(eventId, accepted.id, ids.cy, "accepted");
    expect((await intros.getRevealedContacts(eventId, ids.ann)).map((row) => row.contact.id)).toEqual([ids.cy]);

    await events.setRevoked(eventId, ids.cy, true);
    expect((await intros.listForParticipant(eventId, ids.ann)).some((intro) => intro.id === accepted.id)).toBe(false);
    expect(await intros.getRevealedContacts(eventId, ids.ann)).toEqual([]);

    await events.setRevoked(eventId, ids.cy, false);
    expect((await intros.getRevealedContacts(eventId, ids.ann)).map((row) => row.contact.id)).toEqual([ids.cy]);
  });
});
