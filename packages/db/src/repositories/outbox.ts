import { query, transaction } from "../client";

export type NotificationKind = "intro.requested" | "intro.accepted" | "location.requested" | "location.answered";

export interface OutboxItem {
  id: number;
  event_id: string | null;
  recipient_id: string;
  kind: NotificationKind;
  subject_id: string;
  attempts: number;
}

export const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 120;
/** Sent notifications are kept this long, then swept. */
export const SENT_RETENTION_DAYS = 30;

/**
 * Queues a notification. Pass the transaction's client so it commits or
 * rolls back with the interaction it announces. A repeated dedupe key is
 * ignored, so the same notification is never queued twice.
 */
export async function enqueue(
  item: { eventId: string; recipientId: string; kind: NotificationKind; subjectId: string; dedupeKey: string },
  client: { query: typeof query } = { query }
): Promise<void> {
  await client.query(
    `insert into notification_outbox (event_id, recipient_id, kind, subject_id, dedupe_key)
     values ($1, $2, $3, $4, $5) on conflict (dedupe_key) do nothing`,
    [item.eventId, item.recipientId, item.kind, item.subjectId, item.dedupeKey]
  );
}

/** Claims the oldest due notification (or one whose sender crashed) for delivery. */
export async function claim(onlyEventId: string | null = null): Promise<OutboxItem | null> {
  return transaction(async (client) => {
    await client.query(
      `update notification_outbox set status = 'failed', last_error = coalesce(last_error, 'sender stopped responding')
        where status = 'running' and lease_until < now() and attempts >= $1`, [MAX_ATTEMPTS]);
    const { rows } = await client.query<OutboxItem>(
      `with next_item as (
         select id from notification_outbox
          where attempts < $1 and ($3::uuid is null or event_id = $3)
            and ((status = 'pending' and available_at <= now()) or (status = 'running' and lease_until < now()))
          order by available_at, id for update skip locked limit 1
       )
       update notification_outbox o set status = 'running', attempts = attempts + 1, lease_until = now() + make_interval(secs => $2)
         from next_item where o.id = next_item.id
       returning o.id::int as id, o.event_id, o.recipient_id, o.kind, o.subject_id, o.attempts`,
      [MAX_ATTEMPTS, LEASE_SECONDS, onlyEventId]
    );
    return rows[0] ?? null;
  });
}

export async function markSent(id: number): Promise<void> {
  await query(`update notification_outbox set status = 'sent', sent_at = now(), lease_until = null where id = $1`, [id]);
}

/** Retries after 30s, 60s, 120s... (capped at 15 minutes); fails for good after the last attempt. */
export async function fail(id: number, error: string): Promise<void> {
  await query(
    `update notification_outbox
        set status = case when attempts >= $3 then 'failed' else 'pending' end,
            available_at = now() + make_interval(secs => least(30 * power(2, greatest(attempts - 1, 0)), 900)),
            lease_until = null, last_error = left($2, 1000)
      where id = $1`,
    [id, error, MAX_ATTEMPTS]
  );
}

/** Nothing left to send (e.g. the interaction was deleted): close it without delivery. */
export async function skip(id: number, reason: string): Promise<void> {
  await query(`update notification_outbox set status = 'sent', sent_at = now(), lease_until = null, last_error = $2 where id = $1`, [id, reason]);
}
