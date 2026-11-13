/**
 * Query-sensitive retrieval without embeddings, and search filters, against a
 * real Postgres. Uses its own organization, event and attendees.
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendees, closePool, events, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresParticipantRepository } from "../../apps/web/src/infrastructure/postgres/participant.repo";
import { Intent } from "../../apps/web/src/domain/participant/intent";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const ORG = `search-${RUN}`;
const email = (key: string) => `search-${key}-${RUN}@example.com`;

// Neutral names: names are part of the searchable text.
const NAMES: Record<string, string> = { designer: "Ana Rao", engineer: "Ben Iyer", founder: "Cy Das" };
const PEOPLE = {
  designer: { designation: "Product Designer", domain: "Design", about_me: "Designing climate tools", intent: "NETWORKING", interests: ["climate"] },
  engineer: { designation: "ML Engineer", domain: "AI", about_me: "Builds retrieval and search systems", intent: "NETWORKING", interests: ["rag"] },
  founder: { designation: "Founder", domain: "ai", about_me: "Hiring engineers for search", intent: "HIRING", interests: ["search"] },
} as const;

describeDb("search retrieval", () => {
  const repo = new PostgresParticipantRepository();
  let eventId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(Object.keys(PEOPLE).map((key) => ({ name: NAMES[key], email: email(key) })));
    for (const key of Object.keys(PEOPLE)) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, Object.values(ids));
    for (const [key, person] of Object.entries(PEOPLE)) {
      await query(
        `update event_participants set designation = $3, domain = $4, about_me = $5, intent = $6, interests = $7, profile_updated_at = now()
          where event_id = $1 and attendee_id = $2`,
        [eventId, ids[key], person.designation, person.domain, person.about_me, person.intent, person.interests]
      );
    }
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email like $1`, [`search-%-${RUN}@example.com`]);
    await closePool();
  });

  const names = async (input: Parameters<PostgresParticipantRepository["listCandidates"]>[0]) =>
    (await repo.listCandidates(input)).map((profile) => profile.name);

  it("returns only people matching the query words, best match first", async () => {
    expect(await names({ eventId, excludeAttendeeId: null, terms: ["climate"] })).toEqual(["Ana Rao"]);
    const searchers = await names({ eventId, excludeAttendeeId: null, terms: ["search", "engineer"] });
    expect(searchers.sort()).toEqual(["Ben Iyer", "Cy Das"]);
    expect(await names({ eventId, excludeAttendeeId: null, terms: ["quantum"] })).toEqual([]);
  });

  it("matches word prefixes", async () => {
    expect(await names({ eventId, excludeAttendeeId: null, terms: ["design"] })).toEqual(["Ana Rao"]);
  });

  it("applies intent and domain filters, ignoring domain case", async () => {
    expect(await names({ eventId, excludeAttendeeId: null, terms: ["search"], filters: { intent: Intent.HIRING, domain: null } })).toEqual(["Cy Das"]);
    expect((await names({ eventId, excludeAttendeeId: null, filters: { intent: null, domain: "AI" } })).sort()).toEqual(["Ben Iyer", "Cy Das"]);
  });

  it("ranks by vector only among candidates embedded by the query's model", async () => {
    const unit = (index: number) => Array.from({ length: 768 }, (_, i) => (i === index ? 1 : 0));
    // Ana's vector matches the query exactly but comes from another model; Ben's is close and from the same one.
    await query(`update event_participants set embedding = $3::vector, embedding_model = 'other-model' where event_id = $1 and attendee_id = $2`,
      [eventId, ids.designer, `[${unit(0).join(",")}]`]);
    await query(`update event_participants set embedding = $3::vector, embedding_model = 'query-model' where event_id = $1 and attendee_id = $2`,
      [eventId, ids.engineer, `[${unit(0).map((v, i) => (i === 1 ? 0.5 : v)).join(",")}]`]);
    const ranked = await names({ eventId, excludeAttendeeId: null, embedding: unit(0), embeddingModel: "query-model" });
    expect(ranked[0]).toBe("Ben Iyer");
    expect(ranked).toContain("Ana Rao");
  });

  it("lists each domain present once", async () => {
    expect(await repo.listDomains(eventId)).toEqual(["AI", "Design"]);
  });
});
