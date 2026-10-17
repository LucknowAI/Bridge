export interface CandidateCache {
  get(key: string): Promise<string[] | null>;
  set(key: string, candidateIds: string[], ttlSeconds: number): Promise<void>;
}
