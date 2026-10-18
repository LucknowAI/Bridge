import { audit } from "@match-maker/db";
import type { AuditLog } from "../../application/ports/audit-log";

export class PostgresAuditLog implements AuditLog {
  async record(entry: Parameters<AuditLog["record"]>[0]): Promise<void> {
    try {
      await audit.record(entry);
    } catch (error) {
      // An unavailable audit table must not undo or block the action it records.
      console.error("[audit] could not record", entry.action, error);
    }
  }

  async recent(eventId: string, limit = 20) {
    return (await audit.listForEvent(eventId, limit)).map((row) => ({
      id: row.id, action: row.action, actorName: row.actor_name, subjectName: row.subject_name, details: row.details, createdAt: row.created_at,
    }));
  }
}
