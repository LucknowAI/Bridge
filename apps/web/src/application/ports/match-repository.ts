import type { MatchCandidate } from "../../domain/matching/match-strategy";

export interface MatchRepository {
  save(eventId: string, participantId: string, candidates: MatchCandidate[]): Promise<void>;
  listForParticipant(eventId: string, participantId: string, limit?: number): Promise<MatchCandidate[]>;
}
