import type { MatchCandidate } from "../../domain/matching/match-strategy";
import type { ParticipantProfile } from "../../domain/participant/participant.entity";

export interface LlmProvider {
  /** Identifies the provider and model, recorded with every reranked result. */
  readonly id: string;
  /** Bump when the prompt changes, so cached explanations are not reused across prompts. */
  readonly promptVersion: string;
  rerank(viewer: ParticipantProfile, candidates: MatchCandidate[]): Promise<MatchCandidate[]>;
}
