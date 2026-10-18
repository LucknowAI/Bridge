/** Cached match reasons for single viewer -> candidate pairs (never a ranking). */
export interface ExplanationCache {
  getMany(keys: string[]): Promise<Map<string, string>>;
  setMany(entries: Array<{ key: string; eventId: string; viewerId: string; candidateId: string; reason: string }>, ttlSeconds: number): Promise<void>;
}
