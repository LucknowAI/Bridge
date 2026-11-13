import { query, transaction } from "@match-maker/db";
import type { MatchRepository } from "../../application/ports/match-repository";
import type { MatchCandidate } from "../../domain/matching/match-strategy";
import type { ParticipantProfile } from "../../domain/participant/participant.entity";
import { Intent } from "../../domain/participant/intent";
import { ELIGIBLE_CANDIDATE } from "./participant.repo";

interface MatchRow {
  event_id: string;
  attendee_id: string;
  name: string | null;
  designation: string | null;
  domain: string | null;
  about_me: string | null;
  self_description: string | null;
  years_of_experience: number | null;
  most_impressive_build: string | null;
  intent: string;
  interests: string[] | null;
  venue_zone: string | null;
  visible: boolean;
  score: number;
  score_breakdown: Record<string, number>;
  mutual_interest: boolean;
  match_reason: string | null;
};

export class PostgresMatchRepository implements MatchRepository {
  async save(eventId: string, participantId: string, candidates: MatchCandidate[], computationVersion: string, expectedRevision?: number): Promise<boolean> {
    return transaction(async (client) => {
      if (expectedRevision !== undefined) {
        // Lock the profile row so a save cannot slip in between check and write.
        // NO KEY UPDATE still blocks a profile save, but not the key-share locks
        // other people's match inserts take on this row through their foreign
        // keys; FOR UPDATE made two lists naming each other deadlock.
        const { rows } = await client.query<{ profile_revision: string }>(
          `select profile_revision from event_participants where event_id = $1 and attendee_id = $2 for no key update`, [eventId, participantId]);
        if (!rows[0] || Number(rows[0].profile_revision) !== expectedRevision) return false;
      }
      await client.query(`delete from event_matches where event_id = $1 and participant_id = $2`, [eventId, participantId]);
      if (candidates.length === 0) return true;
      // Array position is the final (possibly reranked) order, stored as rank 1..N.
      await client.query(
        `insert into event_matches
          (event_id, participant_id, candidate_id, rank, score, score_breakdown, match_reason, mutual_interest, computation_version)
         select $1, $2, c.candidate_id, c.rank, c.score, c.score_breakdown, c.match_reason, c.mutual_interest, $3
           from unnest($4::uuid[], $5::int[], $6::numeric[], $7::jsonb[], $8::text[], $9::boolean[])
             as c(candidate_id, rank, score, score_breakdown, match_reason, mutual_interest)`,
        [eventId, participantId, computationVersion,
          candidates.map((candidate) => candidate.participant.attendeeId),
          candidates.map((_, index) => index + 1),
          candidates.map((candidate) => candidate.score),
          candidates.map((candidate) => JSON.stringify(candidate.scoreBreakdown)),
          candidates.map((candidate) => candidate.reason),
          candidates.map((candidate) => candidate.mutualInterest)]
      );
      return true;
    });
  }

  async listForParticipant(eventId: string, participantId: string, limit = 50): Promise<MatchCandidate[]> {
    const { rows } = await query<MatchRow>(
      `select p.event_id, a.id as attendee_id, a.name,
              coalesce(p.designation, a.designation) as designation,
              coalesce(p.domain, a.domain) as domain,
              coalesce(p.about_me, a.about_me) as about_me,
              coalesce(p.self_description, a.self_description) as self_description,
              coalesce(p.years_of_experience, a.years_of_experience) as years_of_experience,
              coalesce(p.most_impressive_build, a.most_impressive_build) as most_impressive_build,
              p.intent, p.interests, p.venue_zone, p.visible,
              m.score, m.score_breakdown, m.mutual_interest, m.match_reason
         from event_matches m
         join event_participants p on p.event_id = m.event_id and p.attendee_id = m.candidate_id
         join registered_attendees a on a.id = p.attendee_id
        where m.event_id = $1 and m.participant_id = $2 and ${ELIGIBLE_CANDIDATE}
        order by m.rank, m.candidate_id limit $3`,
      [eventId, participantId, Math.max(1, Math.min(100, limit))]
    );
    return rows.map((row) => ({
      participant: {
        eventId: row.event_id,
        attendeeId: row.attendee_id,
        name: row.name ?? "Participant",
        designation: row.designation,
        domain: row.domain,
        aboutMe: row.about_me,
        selfDescription: row.self_description,
        yearsOfExperience: row.years_of_experience == null ? null : Number(row.years_of_experience),
        mostImpressiveBuild: row.most_impressive_build,
        intent: Object.values(Intent).includes(row.intent as Intent) ? row.intent as Intent : Intent.NETWORKING,
        interests: row.interests ?? [],
        venueZone: row.venue_zone,
        visible: row.visible,
      },
      score: Number(row.score),
      scoreBreakdown: row.score_breakdown ?? {},
      mutualInterest: row.mutual_interest,
      reason: row.match_reason,
    }));
  }

}
