/** Records sensitive actions. Recording must never block or fail the action itself. */
export interface AuditLog {
  record(entry: {
    eventId?: string | null;
    actorId?: string | null;
    action: string;
    subjectId?: string | null;
    details?: Record<string, unknown>;
  }): Promise<void>;
  /** The event's most recent records, newest first, with people's names. */
  recent(eventId: string, limit?: number): Promise<Array<{
    id: string; action: string; actorName: string | null; subjectName: string | null; details: Record<string, unknown>; createdAt: Date;
  }>>;
}
