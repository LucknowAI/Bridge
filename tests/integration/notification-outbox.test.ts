/**
 * Notifications go through an outbox written with the interaction, and are
 * delivered with retries. Real Postgres; delivery uses the e-mail dev
 * fallback. Claims are scoped to this test's event. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { attendees, closePool, events, outbox, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { PostgresIntroRepository } from "../../apps/web/src/infrastructure/postgres/intro.repo";
import { processNotification } from "../../packages/db/workers/notification.worker";
import { getContainer } from "../../apps/web/src/composition/container";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const RUN = Date.now().toString(36);
const ORG = `outbox-${RUN}`;
const email = (key: string) => `outbox-${key}-${RUN}@example.com`;

describeDb("notification outbox", () => {
  const intros = new PostgresIntroRepository();
  const ids: Record<string, string> = {};
  let eventId: string;
  let introId: string;
  const queued = async () => (await query<{ kind: string; recipient_id: string; status: string; attempts: number; last_error: string | null }>(
    `select kind, recipient_id, status, attempts, last_error from notification_outbox where event_id = $1 order by id`, [eventId])).rows;

  beforeAll(async () => {
    process.env.EMAIL_DEV_FALLBACK = "true";
    await migrate();
    await attendees.upsertMany(["amy", "ben"].map((key) => ({ name: `Outbox ${key}`, email: email(key) })));
    for (const key of ["amy", "ben"]) ids[key] = (await attendees.findByEmail(email(key)))!.id;
    const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [ORG]);
    eventId = (await query<{ id: string }>(`insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, ORG])).rows[0].id;
    await events.attachRoster(eventId, Object.values(ids));
  });

  afterAll(async () => {
    await query(`delete from organizations where slug = $1`, [ORG]);
    await query(`delete from registered_attendees where email like $1`, [`outbox-%-${RUN}@example.com`]);
    await closePool();
  });

  it("queues the notification with the request, once", async () => {
    introId = (await intros.create({ eventId, requesterId: ids.amy, recipientId: ids.ben })).id;
    await outbox.enqueue({ eventId, recipientId: ids.ben, kind: "intro.requested", subjectId: introId, dedupeKey: `intro.requested:${introId}` });
    expect(await queued()).toEqual([expect.objectContaining({ kind: "intro.requested", recipient_id: ids.ben, status: "pending" })]);
  });

  it("delivers it with a link to the connection", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await processNotification(eventId)).toBe(true);
    expect((await queued())[0].status).toBe("sent");
    const message = info.mock.calls.map((call) => String(call[0])).find((line) => line.includes(email("ben")));
    expect(message).toContain(`/e/${ORG}/connections#intro-${introId}`);
    info.mockRestore();
  });

  it("queues an acceptance notice for the requester", async () => {
    await intros.respond(eventId, introId, ids.ben, "accepted");
    expect((await queued()).at(-1)).toMatchObject({ kind: "intro.accepted", recipient_id: ids.amy, status: "pending" });
  });

  it("keeps a failed delivery for retry instead of losing it", async () => {
    const container = getContainer();
    const failing = vi.spyOn(container.notifications, "introAccepted").mockRejectedValueOnce(new Error("Resend failed (503)"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await processNotification(eventId);
    expect((await queued()).at(-1)).toMatchObject({ status: "pending", attempts: 1, last_error: "Resend failed (503)" });
    failing.mockRestore();
    await query(`update notification_outbox set available_at = now() where event_id = $1 and status = 'pending'`, [eventId]);
    vi.spyOn(console, "info").mockImplementation(() => {});
    await processNotification(eventId);
    expect((await queued()).at(-1)).toMatchObject({ status: "sent", attempts: 2 });
  });
});
