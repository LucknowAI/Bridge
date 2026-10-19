import type { MatchCandidate } from "../../domain/matching/match-strategy";

export interface MatchRepository {
  /** Replaces the participant's matches; array order is the order shown to them. */
  /**
   * With `expectedRevision`, writes only while the participant's profile is
   * still at that revision and returns false otherwise (a newer job will).
   */
  save(eventId: string, participantId: string, candidates: MatchCandidate[], computationVersion: string, expectedRevision?: number): Promise<boolean>;
  listForParticipant(eventId: string, participantId: string, limit?: number): Promise<MatchCandidate[]>;
}
