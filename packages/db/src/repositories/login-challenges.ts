import { query } from "../client";
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
 * Start a login attempt. Any earlier unconsumed challenge for the same e-mail
 * is expired first, so requesting a new code silently invalidates the old one
 * and only the newest e-mail in the inbox works.
 */
export async function create(
  input: CreateChallengeInput
): Promise<LoginChallenge> {
  await query(
    `update login_challenges
        set expires_at = now()
      where email = $1 and consumed_at is null and expires_at > now()`,
    [input.email]
  );

  const { rows } = await query<LoginChallenge>(
    `insert into login_challenges
       (email, attendee_id, code_hash, token_hash, expires_at, ip_address)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      input.email,
      input.attendeeId,
      input.codeHash,
      input.tokenHash,
      input.expiresAt,
      input.ipAddress,
    ]
  );

  // The insert always returns exactly one row; the throw is for the type checker.
  const row = rows[0];
  if (!row) throw new Error("Failed to create login challenge");
  return row;
}

/** The newest live challenge for an e-mail, used by the 6-digit code path. */
export async function findLiveByEmail(
  email: string
): Promise<LoginChallenge | null> {
  const { rows } = await query<LoginChallenge>(
    `select * from login_challenges
      where email = $1
        and consumed_at is null
        and expires_at > now()
        and attempts < $2
      order by created_at desc
      limit 1`,
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

export async function incrementAttempts(id: string): Promise<number> {
  const { rows } = await query<{ attempts: number }>(
    `update login_challenges set attempts = attempts + 1
      where id = $1 returning attempts`,
    [id]
  );
  return rows[0]?.attempts ?? MAX_CODE_ATTEMPTS;
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

/** Challenges started for this e-mail inside the window — feeds the rate limit. */
export async function countRecent(
  email: string,
  windowSeconds: number
): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `select count(*)::text as count from login_challenges
      where email = $1 and created_at > now() - ($2 || ' seconds')::interval`,
    [email, String(windowSeconds)]
  );
  return Number(rows[0]?.count ?? 0);
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
