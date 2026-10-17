import { query } from "../client";
import type { MatchSession } from "../types";

export interface RecordedMatch {
  attendeeId: string;
  score: number | null;
  reason: string | null;
}

/** Persist one matchmaking run so results survive a page reload. */
export async function recordMatches(
  userSubject: string,
  matches: RecordedMatch[]
): Promise<number> {
  if (matches.length === 0) return 0;

  const values: unknown[] = [];
  const tuples = matches.map((match, i) => {
    values.push(userSubject, match.attendeeId, match.score, match.reason);
    return `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`;
  });

  const { rowCount } = await query(
    `insert into match_sessions (user_subject, matched_with, score, match_reason)
     values ${tuples.join(", ")}`,
    values
  );
  return rowCount ?? 0;
}

export async function listForUser(
  userSubject: string,
  limit = 50
): Promise<MatchSession[]> {
  const { rows } = await query<MatchSession>(
    `select * from match_sessions
      where user_subject = $1
      order by created_at desc
      limit $2`,
    [userSubject, limit]
  );
  return rows;
}
