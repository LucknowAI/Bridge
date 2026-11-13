import type { MatchCandidate } from "../../domain/matching/match-strategy";

export interface MatchRepository {
  /** Replaces the participant's matches; array order is the order shown to them. */
  save(eventId: string, participantId: string, candidates: MatchCandidate[], computationVersion: string): Promise<void>;
  listForParticipant(eventId: string, participantId: string, limit?: number): Promise<MatchCandidate[]>;
}
