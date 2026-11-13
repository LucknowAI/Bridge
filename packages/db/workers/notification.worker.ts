import { events, outbox, query } from "../src/index";
import { getContainer } from "../../../apps/web/src/composition/container";

/**
 * Delivers one queued notification. Details are read at send time, so the
 * message reflects the current state; an interaction that no longer exists
 * is closed without sending. Failures retry with backoff (see outbox.fail).
 */
export async function processNotification(onlyEventId: string | null = null): Promise<boolean> {
  const item = await outbox.claim(onlyEventId);
  if (!item) return false;
  try {
    const delivered = await deliver(item);
    if (delivered) await outbox.markSent(item.id);
    else await outbox.skip(item.id, "nothing to send any more");
  } catch (error) {
    console.error(`[worker:notify] ${item.kind} #${item.id} failed`, error);
    await outbox.fail(item.id, error instanceof Error ? error.message : String(error));
  }
  return true;
}

async function deliver(item: outbox.OutboxItem): Promise<boolean> {
  if (!item.event_id) return false;
  const { participants, notifications } = getContainer();
  const event = await events.basics(item.event_id);
  const recipient = await participants.findProfile(item.event_id, item.recipient_id);
  if (!event || !recipient?.email) return false;

  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (item.kind === "intro.requested" || item.kind === "intro.accepted") {
    const { rows: [intro] } = await query<{ requester_id: string; recipient_id: string; status: string }>(
      `select requester_id, recipient_id, status from intro_requests where id = $1`, [item.subject_id]);
    if (!intro || (item.kind === "intro.accepted" && intro.status !== "accepted")) return false;
    const otherId = intro.requester_id === item.recipient_id ? intro.recipient_id : intro.requester_id;
    const other = await participants.findProfile(item.event_id, otherId);
    const target = { recipientEmail: recipient.email, recipientName: recipient.name, otherName: other?.name ?? "A participant", eventName: event.name, link: `${base}/e/${event.slug}/connections#intro-${item.subject_id}` };
    await (item.kind === "intro.requested" ? notifications.introRequested(target) : notifications.introAccepted(target));
    return true;
  }

  const { rows: [request] } = await query<{ intro_id: string; requester_id: string; recipient_id: string; status: string; zone: string | null }>(
    `select intro_id, requester_id, recipient_id, status, zone from location_requests where id = $1`, [item.subject_id]);
  if (!request) return false;
  const otherId = request.requester_id === item.recipient_id ? request.recipient_id : request.requester_id;
  const other = await participants.findProfile(item.event_id, otherId);
  const target = { recipientEmail: recipient.email, recipientName: recipient.name, otherName: other?.name ?? "A participant", eventName: event.name, link: `${base}/e/${event.slug}/connections#intro-${request.intro_id}` };
  if (item.kind === "location.requested") {
    if (request.status !== "pending") return false;
    await notifications.locationRequested(target);
  } else {
    await notifications.locationAnswered({ ...target, zone: request.status === "answered" ? request.zone : null });
  }
  return true;
}
