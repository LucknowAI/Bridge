import type { MatchCandidate } from "../../domain/matching/match-strategy";
import type { ParticipantProfile } from "../../domain/participant/participant.entity";

export interface LlmProvider {
  /** Identifies the provider and model, recorded with every reranked result. */
  readonly id: string;
  rerank(viewer: ParticipantProfile, candidates: MatchCandidate[]): Promise<MatchCandidate[]>;
}
