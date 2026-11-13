import type { MatchCandidate } from "../../domain/matching/match-strategy";
import type { ParticipantProfile } from "../../domain/participant/participant.entity";

export interface LlmProvider {
  rerank(viewer: ParticipantProfile, candidates: MatchCandidate[]): Promise<MatchCandidate[]>;
}
