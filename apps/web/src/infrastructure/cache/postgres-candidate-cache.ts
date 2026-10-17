import { query } from "@match-maker/db";
import type { CandidateCache } from "../../application/ports/candidate-cache";

export class PostgresCandidateCache implements CandidateCache {
  async get(key: string): Promise<string[] | null> {
    const { rows } = await query<{ candidate_ids: string[] }>(
      `select candidate_ids from retrieval_cache where cache_key = $1 and expires_at > now()`, [key]
    );
    return rows[0]?.candidate_ids ?? null;
  }

  async set(key: string, candidateIds: string[], ttlSeconds: number): Promise<void> {
    await query(
      `insert into retrieval_cache (cache_key, candidate_ids, expires_at)
       values ($1, $2::jsonb, now() + ($3 || ' seconds')::interval)
       on conflict (cache_key) do update set candidate_ids = excluded.candidate_ids, expires_at = excluded.expires_at`,
      [key, JSON.stringify(candidateIds), String(ttlSeconds)]
    );
  }
}
