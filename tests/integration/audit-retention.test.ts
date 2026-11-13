/**
 * Audit records and data retention against a real Postgres (and the local
 * Keycloak realm for erasure). Uses its own organization, event and people.
 * Skipped when DATABASE_URL is unset; the erase case also needs Keycloak.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendees, audit, closePool, events, housekeeping, query } from "@match-maker/db";
import { ensureUser, findUserByEmail } from "@match-maker/auth";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresParticipantRepository } from "../../apps/web/src/infrastructure/postgres/participant.repo";
import { manageAccount } from "../../tools/manage-account";
import { Intent } from "../../apps/web/src/domain/participant/intent";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const issuer = (process.env.KEYCLOAK_INTERNAL_ISSUER || process.env.KEYCLOAK_ISSUER || "").replace(/\/$/, "");
const keycloakUp = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3000) }).then((res) => res.ok).catch(() => false);
const RUN = Date.now().toString(36);
const ORG = `audit-${RUN}`;
const email = (key: string) => `audit-${key}-${RUN}@example.com`;

describeDb("audit records and retention", () => {
  const participants = new PostgresParticipantRepository();
  const ids: Record<string, string> = {};
  let eventId: string;

  const explain = (viewer: string, candidate: string) => query(
    `insert into pair_explanations (cache_key, event_id, viewer_id, candidate_id, reason, expires_at)
     values ($1, $2, $3, $4, 'reason', now() + interval '1 day')`, [randomUUID(), eventId, viewer, candidate]);
  const explanationsAbout = async (id: string) =>
    (await query(`select 1 from pair_explanations where viewer_id = $1 or candidate_id = $1`, [id])).rows.length;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany(["org", "kim", "lou", "max"].map((key) => ({ name: `Audit ${key}`, email: email(key) })));
    for (const key of ["org", "kim", "lou", "max"]) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, [ids.kim, ids.lou, ids.max]);
  });

  afterAll(async () => {
    await query(`delete from audit_events where subject_id = any($1::uuid[]) or actor_id = any($1::uuid[])`, [Object.values(ids)]);
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email like $1`, [`audit-%-${RUN}@example.com`]);
    await closePool();
  });

  it("records actions with the people involved, newest first", async () => {
    await audit.record({ eventId, actorId: ids.org, action: "roster.imported", details: { attached: 3 } });
    await audit.record({ eventId, actorId: ids.org, action: "access.removed", subjectId: ids.kim });
    const recent = await audit.listForEvent(eventId);
    expect(recent.map((row) => row.action)).toEqual(["access.removed", "roster.imported"]);
    expect(recent[0]).toMatchObject({ actor_name: "Audit org", subject_name: "Audit kim" });
    expect(recent[1].details).toEqual({ attached: 3 });
  });

  it("sweeps records older than the retention period", async () => {
    await audit.record({ eventId, action: "old.action", subjectId: ids.lou });
    await query(`update audit_events set created_at = now() - interval '400 days' where action = 'old.action' and subject_id = $1`, [ids.lou]);
    await housekeeping.sweepExpired();
    expect((await query(`select 1 from audit_events where action = 'old.action' and subject_id = $1`, [ids.lou])).rows).toHaveLength(0);
  });

  it("drops cached explanations about someone removed from the event", async () => {
    await explain(ids.kim, ids.lou);
    await explain(ids.lou, ids.kim);
    await events.setRevoked(eventId, ids.kim, true);
    expect(await explanationsAbout(ids.kim)).toBe(0);
  });

  it("drops explanations of a profile that is hidden", async () => {
    await explain(ids.max, ids.lou);
    await participants.saveProfile({
      eventId, attendeeId: ids.lou, designation: "Engineer", domain: "AI", aboutMe: "x", selfDescription: null,
      yearsOfExperience: null, mostImpressiveBuild: null, intent: Intent.NETWORKING, interests: [], venueZone: null, visible: false,
    });
    expect(await explanationsAbout(ids.lou)).toBe(0);
  });

  (keycloakUp && process.env.KEYCLOAK_ADMIN_PASSWORD ? it : it.skip)("erases a person, their event data and their Keycloak user", async () => {
    await ensureUser(email("max"), "Audit max");
    await explain(ids.lou, ids.max);
    const report = await manageAccount("erase", email("max"));
    expect(report.join("\n")).toMatch(/keycloak: user deleted/);
    expect(await attendees.findByEmail(email("max"))).toBeNull();
    expect((await query(`select 1 from event_participants where attendee_id = $1`, [ids.max])).rows).toHaveLength(0);
    expect(await explanationsAbout(ids.max)).toBe(0);
    expect(await findUserByEmail(email("max"))).toBeNull();
    expect((await query(`select 1 from audit_events where action = 'account.erased' and subject_id = $1`, [ids.max])).rows).toHaveLength(1);
  });

  it("keeps records when their event is deleted", async () => {
    await query(`delete from events where id = $1`, [eventId]);
    expect((await query(`select event_id from audit_events where action = 'roster.imported' and actor_id = $1`, [ids.org])).rows[0].event_id).toBeNull();
  });
});
