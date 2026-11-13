import { query, transaction } from "../client";
import type { LoginChallenge } from "../types";

/** A code may be mistyped a few times; beyond this the challenge is burned. */
export const MAX_CODE_ATTEMPTS = 5;

export interface CreateChallengeInput {
  email: string;
  attendeeId: string | null;
  codeHash: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress: string | null;
}

/**
 * Start a login attempt, unless the e-mail already had `maxPerWindow` started
 * within `windowSeconds` (then null). Counting and inserting happen under a
 * per-e-mail lock in one transaction, so simultaneous requests cannot all see
 * "under the limit". Any earlier unconsumed challenge is expired, so only the
 * newest e-mail in the inbox works.
 */
export async function createWithinLimit(
  input: CreateChallengeInput,
  limit: { maxPerWindow: number; windowSeconds: number }
): Promise<LoginChallenge | null> {
  return transaction(async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext('login-challenge:' || $1))`, [input.email]);
    const { rows: [recent] } = await client.query<{ count: number }>(
      `select count(*)::int as count from login_challenges
        where email = $1 and created_at > now() - make_interval(secs => $2)`,
      [input.email, limit.windowSeconds]
    );
    if ((recent?.count ?? 0) >= limit.maxPerWindow) return null;

    await client.query(
      `update login_challenges set expires_at = now()
        where email = $1 and consumed_at is null and expires_at > now()`,
      [input.email]
    );
    const { rows } = await client.query<LoginChallenge>(
      `insert into login_challenges
         (email, attendee_id, code_hash, token_hash, expires_at, ip_address)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [input.email, input.attendeeId, input.codeHash, input.tokenHash, input.expiresAt, input.ipAddress]
    );
    return rows[0] ?? null;
  });
}

/**
 * Spend one code attempt on the newest live challenge for an e-mail and return
 * it with the updated count, or null when none is live or attempts are used up.
 * The attempt is taken before the code is compared, in one UPDATE that
 * re-checks `attempts < max` under the row lock, so parallel guesses can never
 * get more than MAX_CODE_ATTEMPTS comparisons.
 */
export async function reserveAttempt(email: string): Promise<LoginChallenge | null> {
  const { rows } = await query<LoginChallenge>(
    `update login_challenges set attempts = attempts + 1
      where id = (
              select id from login_challenges
               where email = $1 and consumed_at is null and expires_at > now()
               order by created_at desc limit 1
            )
        and attempts < $2 and consumed_at is null and expires_at > now()
      returning *`,
    [email, MAX_CODE_ATTEMPTS]
  );
  return rows[0] ?? null;
}

/** Look a challenge up by magic-link token. */
export async function findLiveByTokenHash(
  tokenHash: string
): Promise<LoginChallenge | null> {
  const { rows } = await query<LoginChallenge>(
    `select * from login_challenges
      where token_hash = $1 and consumed_at is null and expires_at > now()
      limit 1`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

/**
 * Atomically mark a challenge used.
 *
 * Returns false when the row was already consumed. The `consumed_at is null`
 * predicate inside the UPDATE is what makes this safe: if the magic link and
 * the typed code arrive at the same instant, exactly one of them wins.
 */
export async function consume(id: string): Promise<boolean> {
  const { rowCount } = await query(
    `update login_challenges set consumed_at = now()
      where id = $1 and consumed_at is null`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}

/** Housekeeping: drop rows that can no longer be redeemed. */
export async function deleteExpired(olderThanHours = 24): Promise<number> {
  const { rowCount } = await query(
    `delete from login_challenges
      where expires_at < now() - ($1 || ' hours')::interval`,
    [String(olderThanHours)]
  );
  return rowCount ?? 0;
}
