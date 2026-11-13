import { query } from "@match-maker/db";
import type { RateLimiter } from "../../application/ports/rate-limiter";

/** Shared rate limiting for every web replica, backed by the existing database. */
export class PostgresRateLimiter implements RateLimiter {
  async consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const { rows } = await query<{ count: number }>(
      `insert into rate_limit_buckets (bucket_key, window_started_at, count)
       values ($1, now(), 1)
       on conflict (bucket_key) do update set
         window_started_at = case
           when rate_limit_buckets.window_started_at <= now() - ($3 || ' seconds')::interval then now()
           else rate_limit_buckets.window_started_at end,
         count = case
           when rate_limit_buckets.window_started_at <= now() - ($3 || ' seconds')::interval then 1
           else rate_limit_buckets.count + 1 end
       returning count`,
      [key, limit, String(windowSeconds)]
    );
    return Number(rows[0]?.count ?? limit + 1) <= limit;
  }
}
