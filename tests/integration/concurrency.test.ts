/**
 * Races against a real Postgres: the same action sent twice at once, crossing
 * requests, an accept racing a decline, and overlapping roster imports must
 * each leave exactly one outcome. Uses its own organization, event and
 * people. Skipped without DATABASE_URL.
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
const ORG = `race-${RUN}`;
const KEYS = Array.from({ length: 12 }, (_, i) => `p${i}`);
const email = (key: string) => `race-${key}-${RUN}@example.com`;

describeDb("concurrent actions", () => {
  const intros = new PostgresIntroRepository();
  const locations = new PostgresLocationRepository();
  const participants = new PostgresParticipantRepository();
  const matches = new PostgresMatchRepository();
  const ids: Record<string, string> = {};
  let eventId: string;

  const settle = <T>(promises: Array<Promise<T>>) => Promise.allSettled(promises);
  const fulfilled = (results: PromiseSettledResult<unknown>[]) => results.filter((result) => result.status === "fulfilled").length;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(KEYS.map((key) => ({ name: `Race ${key}`, email: email(key) })));
    for (const key of KEYS) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, Object.values(ids));
    for (const key of KEYS) {
      await participants.saveProfile({
        eventId, attendeeId: ids[key], designation: "Engineer", domain: "AI", aboutMe: "Builds things", selfDescription: null,
        yearsOfExperience: null, mostImpressiveBuild: null, intent: Intent.NETWORKING, interests: [], venueZone: null,
      });
    }
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email like $1`, [`race-%-${RUN}@example.com`]);
    await closePool();
  });

  const ask = (from: string, to: string) => requestIntro({ eventId, requesterId: ids[from], recipientId: ids[to] }, { participants, intros });
  const between = async (a: string, b: string) => (await intros.findBetween(eventId, ids[a], ids[b])).length;

  it("creates one request when the same request is sent twice at once", async () => {
    expect(fulfilled(await settle([ask("p0", "p1"), ask("p0", "p1"), ask("p0", "p1")]))).toBe(1);
    expect(await between("p0", "p1")).toBe(1);
  });

  it("creates one request when two people ask each other at the same moment", async () => {
    for (const [a, b] of [["p2", "p3"], ["p4", "p5"], ["p6", "p7"]]) {
      expect(fulfilled(await settle([ask(a, b), ask(b, a)]))).toBe(1);
      expect(await between(a, b)).toBe(1);
    }
  });

  it("lets only one of an accept and a decline win, with one notification at most", async () => {
    const intro = await ask("p8", "p9");
    const results = await settle([
      intros.respond(eventId, intro.id, ids.p9, "accepted"),
      intros.respond(eventId, intro.id, ids.p9, "declined"),
      intros.respond(eventId, intro.id, ids.p9, "accepted"),
    ]);
    expect(fulfilled(results)).toBe(1);
    const final = (await intros.findById(eventId, intro.id))!.status;
    const winner = results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{ status: string }>;
    expect(final).toBe(winner.value.status);
    const accepted = await query(`select 1 from notification_outbox where kind = 'intro.accepted' and subject_id = $1`, [intro.id]);
    expect(accepted.rows).toHaveLength(final === "accepted" ? 1 : 0);
  });

  it("keeps one open location request when the same question is asked twice at once", async () => {
    const intro = await ask("p10", "p11");
    await intros.respond(eventId, intro.id, ids.p11, "accepted");
    const input = { eventId, introId: intro.id, requesterId: ids.p10, recipientId: ids.p11 };
    const created = await Promise.all([locations.create(input), locations.create(input)]);
    expect(created.filter(Boolean)).toHaveLength(1);
  });

  it("saves match lists that name each other at the same time without deadlocking", async () => {
    const group = ["p0", "p1", "p2", "p3", "p4", "p5"];
    const profiles = await Promise.all(group.map((key) => participants.findProfile(eventId, ids[key])));
    const listFor = (key: string) => profiles.filter((profile) => profile!.attendeeId !== ids[key])
      .map((profile) => ({ participant: profile!, score: 50, scoreBreakdown: {}, mutualInterest: false, reason: null }));
    const revisionOf = (key: string) => profiles.find((profile) => profile!.attendeeId === ids[key])!.revision!;
    for (let round = 0; round < 5; round++) {
      const results = await settle(group.map((key) => matches.save(eventId, ids[key], listFor(key), "race", revisionOf(key))));
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      expect(results.map((result) => (result as PromiseFulfilledResult<boolean>).value)).toEqual(group.map(() => true));
    }
  });

  it("imports overlapping roster sheets at once without duplicating anyone", async () => {
    const sheet = (keys: string[]) => keys.map((key) => ({
      name: `Imported ${key}`, email: email(`imp-${key}`), phone: null, about_me: null, designation: null, domain: null,
      self_description: null, years_of_experience: null, most_impressive_build: null,
    }));
    await Promise.all([events.importRoster(eventId, sheet(["a", "b", "c"])), events.importRoster(eventId, sheet(["b", "c", "d"]))]);
    const { rows } = await query<{ email: string; on_roster: number }>(
      `select a.email, count(p.attendee_id)::int as on_roster from registered_attendees a
         left join event_participants p on p.attendee_id = a.id and p.event_id = $1
        where a.email like $2 group by a.email order by a.email`, [eventId, `race-imp-%-${RUN}@example.com`]);
    expect(rows.map((row) => row.on_roster)).toEqual([1, 1, 1, 1]);
  });
});
