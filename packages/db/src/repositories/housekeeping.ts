import { query } from "../client";
import { deleteExpired as deleteExpiredChallenges } from "./login-challenges";

/** How long a dead row is kept before the sweep removes it. */
export const RETENTION = {
  /** Expired login challenges stay a day, for investigating sign-in problems. */
  loginChallengeHours: 24,
  /** Rate-limit windows are at most 15 minutes; a day-old bucket is dead. */
  rateLimitBucketHours: 24,
} as const;

export interface SweepResult {
  loginChallenges: number;
  rateLimitBuckets: number;
  retrievalCache: number;
}

/** Deletes rows that can no longer be used. Safe to run on any schedule. */
export async function sweepExpired(): Promise<SweepResult> {
  const loginChallenges = await deleteExpiredChallenges(RETENTION.loginChallengeHours);
  const buckets = await query(
    `delete from rate_limit_buckets where window_started_at < now() - make_interval(hours => $1)`,
    [RETENTION.rateLimitBucketHours]
  );
  const cache = await query(`delete from retrieval_cache where expires_at < now()`);
  return { loginChallenges, rateLimitBuckets: buckets.rowCount ?? 0, retrievalCache: cache.rowCount ?? 0 };
}
