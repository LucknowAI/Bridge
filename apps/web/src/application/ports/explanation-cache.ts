/**
 * Cached match reasons for single viewer -> candidate pairs, plus the model's
 * order for an exact shortlist (a pair's reason never decides an order).
 */
export interface ExplanationCache {
  getMany(keys: string[]): Promise<Map<string, string>>;
  setMany(entries: Array<{ key: string; eventId: string; viewerId: string; candidateId: string; reason: string }>, ttlSeconds: number): Promise<void>;
  /** Candidate ids in the model's order, or null. */
  getOrder(key: string): Promise<string[] | null>;
  setOrder(entry: { key: string; eventId: string; viewerId: string; candidateIds: string[] }, ttlSeconds: number): Promise<void>;
}
