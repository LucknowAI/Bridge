/**
 * Organizer roles and roster import ownership against a real Postgres. Uses
 * two organizations of its own. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendees, closePool, events, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const ORG_A = `ownership-a-${RUN}`;
const ORG_B = `ownership-b-${RUN}`;
const email = (key: string) => `ownership-${key}-${RUN}@example.com`;
const PHONE_KEPT = `+9196${RUN.slice(-8).padStart(8, "0").replace(/\D/g, "7")}`;

const row = (key: string, overrides: Record<string, unknown> = {}) => ({
  name: `Sheet ${key}`, email: email(key), phone: null, about_me: null, designation: null, domain: null,
  self_description: null, years_of_experience: null, most_impressive_build: null, ...overrides,
});

describeDb("organizer roles and roster import ownership", () => {
  const ids: Record<string, string> = {};
  let eventA: string;
  let eventA2: string;
  let eventB: string;

  async function org(slug: string) {
    const { rows: [created] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [slug]);
    return created.id;
  }

  beforeAll(async () => {
    await migrate();
    // An attendee organization A already registered, with a name and phone.
    await attendees.upsertMany([
      { name: "Original Name", email: email("shared"), phone: PHONE_KEPT, designation: "Engineer" },
      { name: "Org Admin", email: email("admin") },
      { name: "Event Helper", email: email("helper") },
      { name: "Org Member", email: email("member") },
    ]);
    for (const key of ["shared", "admin", "helper", "member"]) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    const orgA = await org(ORG_A);
    const orgB = await org(ORG_B);
    await query(`insert into organization_members (organization_id, attendee_id, role) values ($1, $2, 'admin'), ($1, $3, 'organizer'), ($1, $4, 'organizer')`,
      [orgA, ids.admin, ids.helper, ids.member]);
    eventA = (await events.create({ organizationId: orgA, organizerId: ids.member, name: "A one", slug: `${ORG_A}-one` })).id;
    eventA2 = (await events.create({ organizationId: orgA, organizerId: ids.admin, name: "A two", slug: `${ORG_A}-two` })).id;
    await query(`insert into event_organizers (event_id, attendee_id, role) values ($1, $2, 'organizer')`, [eventA, ids.helper]);
    eventB = (await query<{ id: string }>(`insert into events (organization_id, name, slug) values ($1, 'B', $2) returning id`, [orgB, `${ORG_B}-one`])).rows[0].id;
    await events.attachRoster(eventA, [ids.shared]);
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = any($1::text[])`, [[ORG_A, ORG_B]]);
    await query(`delete from registered_attendees where email like $1`, [`ownership-%-${RUN}@example.com`]);
    await closePool();
  });

  it("gives each role the right reach", async () => {
    expect(await events.organizerRoles(eventA, ids.helper)).toEqual({ event: "organizer", organization: "organizer" });
    expect(await events.isOrganizer(eventA2, ids.admin)).toBe(true);
    expect(await events.isOrganizer(eventA, ids.admin)).toBe(true);
    expect(await events.isOrganizer(eventA2, ids.member)).toBe(false);
    expect(await events.isOrganizer(eventB, ids.admin)).toBe(false);
  });

  it("lets an organization admin save settings of an event they did not create", async () => {
    const updated = await events.update({ eventId: eventA, organizerId: ids.admin, zones: ["Hall"] });
    expect(updated?.zones).toEqual(["Hall"]);
    expect(await events.update({ eventId: eventA2, organizerId: ids.member, zones: ["Nope"] })).toBeNull();
  });

  it("lists only the events a viewer may open", async () => {
    const slugs = async (viewer: string) => (await events.listForOrganization(ORG_A, viewer)).map((event) => event.slug).sort();
    expect(await slugs(ids.admin)).toEqual([`${ORG_A}-one`, `${ORG_A}-two`]);
    expect(await slugs(ids.member)).toEqual([`${ORG_A}-one`]);
  });

  it("never replaces an existing person's details from another organization's sheet", async () => {
    const result = await events.importRoster(eventB, [
      row("shared", { name: "Hijacked Name", phone: "+919000000001", designation: "Attacker" }),
      row("fresh", { phone: PHONE_KEPT }),
    ]);
    expect(result).toEqual({ created: 1, attached: 2, alreadyOnRoster: 0, keptExisting: 1, phoneConflicts: 1 });
    const shared = (await attendees.findByEmail(email("shared")))!;
    expect(shared).toMatchObject({ name: "Original Name", phone: PHONE_KEPT, designation: "Engineer" });
    const fresh = (await attendees.findByEmail(email("fresh")))!;
    expect(fresh.phone).toBeNull();
  });

  it("fills only empty fields of a known person", async () => {
    await events.importRoster(eventB, [row("fresh", { domain: "Climate", name: "Different" })]);
    expect(await attendees.findByEmail(email("fresh"))).toMatchObject({ name: "Sheet fresh", domain: "Climate" });
  });

  it("is safe to retry", async () => {
    const result = await events.importRoster(eventB, [row("shared"), row("fresh")]);
    expect(result).toMatchObject({ created: 0, attached: 0, alreadyOnRoster: 2 });
  });

  it("applies nothing when any row fails", async () => {
    await expect(events.importRoster(eventA2, [row("rollback-ok"), row("rollback-bad", { years_of_experience: "not a number" })])).rejects.toThrow();
    expect(await attendees.findByEmail(email("rollback-ok"))).toBeNull();
    const { rows } = await query(`select 1 from event_participants where event_id = $1`, [eventA2]);
    expect(rows).toHaveLength(0);
  });
});
