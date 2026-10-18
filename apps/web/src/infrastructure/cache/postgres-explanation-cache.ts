import { query } from "@match-maker/db";
import type { ExplanationCache } from "../../application/ports/explanation-cache";

export class PostgresExplanationCache implements ExplanationCache {
  async getMany(keys: string[]): Promise<Map<string, string>> {
    if (!keys.length) return new Map();
    const { rows } = await query<{ cache_key: string; reason: string }>(
      `select cache_key, reason from pair_explanations where cache_key = any($1::text[]) and expires_at > now()`,
      [keys]
    );
    return new Map(rows.map((row) => [row.cache_key, row.reason]));
  }

  async setMany(entries: Parameters<ExplanationCache["setMany"]>[0], ttlSeconds: number): Promise<void> {
    if (!entries.length) return;
    await query(
      `insert into pair_explanations (cache_key, event_id, viewer_id, candidate_id, reason, expires_at)
       select e.key, e.event_id, e.viewer_id, e.candidate_id, e.reason, now() + make_interval(secs => $2)
         from jsonb_to_recordset($1::jsonb) as e(key text, event_id uuid, viewer_id uuid, candidate_id uuid, reason text)
       on conflict (cache_key) do update set reason = excluded.reason, expires_at = excluded.expires_at`,
      [JSON.stringify(entries.map((entry) => ({
        key: entry.key, event_id: entry.eventId, viewer_id: entry.viewerId, candidate_id: entry.candidateId, reason: entry.reason,
      }))), ttlSeconds]
    );
  }
}
