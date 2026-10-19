import { randomUUID } from "node:crypto";
import { query } from "@match-maker/db";
import type { CandidateCache } from "../../application/ports/candidate-cache";

export class PostgresCandidateCache implements CandidateCache {
  async get(key: string): Promise<string[] | null> {
    const value = await this.read(key);
    return Array.isArray(value) && value.every((id) => typeof id === "string") ? value : null;
  }

  async set(key: string, candidateIds: string[], ttlSeconds: number): Promise<void> {
    await this.write(key, candidateIds, ttlSeconds);
  }

  async getVector(key: string): Promise<number[] | null> {
    const value = await this.read(key);
    return Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === "number") ? value : null;
  }

  async setVector(key: string, vector: number[], ttlSeconds: number): Promise<void> {
    await this.write(key, vector, ttlSeconds);
  }

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const { rows } = await query<{ owner: string }>(
      `insert into cache_locks (lock_key, owner, expires_at) values ($1, $2, now() + make_interval(secs => $3))
       on conflict (lock_key) do update set owner = excluded.owner, expires_at = excluded.expires_at
         where cache_locks.expires_at < now()
       returning owner`,
      [key, token, ttlMs / 1000]
    );
    return rows[0]?.owner === token ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await query(`delete from cache_locks where lock_key = $1 and owner = $2`, [key, token]);
  }

  private async read(key: string): Promise<unknown> {
    const { rows } = await query<{ candidate_ids: unknown }>(
      `select candidate_ids from retrieval_cache where cache_key = $1 and expires_at > now()`, [key]
    );
    return rows[0]?.candidate_ids ?? null;
  }

  private async write(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await query(
      `insert into retrieval_cache (cache_key, candidate_ids, expires_at)
       values ($1, $2::jsonb, now() + make_interval(secs => $3))
       on conflict (cache_key) do update set candidate_ids = excluded.candidate_ids, expires_at = excluded.expires_at`,
      [key, JSON.stringify(value), ttlSeconds]
    );
  }
}
