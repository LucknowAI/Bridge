/**
 * Shared cache for search retrieval, visible to every web replica: candidate
 * id lists, query embeddings, and short ownership locks that let concurrent
 * identical searches compute once.
 */
export interface CandidateCache {
  get(key: string): Promise<string[] | null>;
  set(key: string, candidateIds: string[], ttlSeconds: number): Promise<void>;
  getVector(key: string): Promise<number[] | null>;
  setVector(key: string, vector: number[], ttlSeconds: number): Promise<void>;
  /** Takes the lock if free or expired; returns an owner token, or null when someone else holds it. */
  acquire(key: string, ttlMs: number): Promise<string | null>;
  /** Releases the lock only if `token` still owns it. */
  release(key: string, token: string): Promise<void>;
}
