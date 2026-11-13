import { query } from "../client";

export interface AuditEntry {
  eventId?: string | null;
  actorId?: string | null;
  action: string;
  subjectId?: string | null;
  /** Counts and field names only, never contact data. */
  details?: Record<string, unknown>;
}

export interface AuditRecord {
  id: string;
  action: string;
  actor_name: string | null;
  subject_name: string | null;
  details: Record<string, unknown>;
  created_at: Date;
}

/** Audit records are kept this long, then swept. */
export const AUDIT_RETENTION_DAYS = 365;

export async function record(entry: AuditEntry): Promise<void> {
  await query(
    `insert into audit_events (event_id, actor_id, action, subject_id, details) values ($1, $2, $3, $4, $5::jsonb)`,
    [entry.eventId ?? null, entry.actorId ?? null, entry.action, entry.subjectId ?? null, JSON.stringify(entry.details ?? {})]
  );
}

export async function listForEvent(eventId: string, limit = 20): Promise<AuditRecord[]> {
  const { rows } = await query<AuditRecord>(
    `select e.id::text as id, e.action, actor.name as actor_name, subject.name as subject_name, e.details, e.created_at
       from audit_events e
       left join registered_attendees actor on actor.id = e.actor_id
       left join registered_attendees subject on subject.id = e.subject_id
      where e.event_id = $1
      order by e.created_at desc, e.id desc
      limit $2`,
    [eventId, limit]
  );
  return rows;
}
