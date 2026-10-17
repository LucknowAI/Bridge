import type { LlmProvider } from "../../../application/ports/llm-provider";
import type { ParticipantProfile } from "../../participant/participant.entity";
import type { MatchCandidate } from "../match-strategy";

export interface RerankResult {
  candidates: MatchCandidate[];
  /** `llm:<provider id>` when the model ordered the list, `score` for the fallback. */
  rankedBy: string;
}

export class LlmRerankStage {
  constructor(private readonly provider: LlmProvider | null) {}

  async execute(viewer: ParticipantProfile, candidates: MatchCandidate[]): Promise<RerankResult> {
    const scored = { candidates: candidates.map(addFallbackReason), rankedBy: "score" };
    if (!this.provider || candidates.length === 0) return scored;
    try {
      const reranked = await this.provider.rerank(viewer, candidates);
      return { candidates: reranked.map(addFallbackReason), rankedBy: `llm:${this.provider.id}` };
    } catch (error) {
      console.warn("[matching] LLM rerank unavailable; using scored order", error);
      return scored;
    }
  }
}

function addFallbackReason(candidate: MatchCandidate): MatchCandidate {
  if (candidate.reason) return candidate;
  const person = candidate.participant;
  const sharedIntent = candidate.mutualInterest ? "Your networking goals align" : "Their background adds a complementary perspective";
  const detail = person.domain ? ` in ${person.domain}` : "";
  return { ...candidate, reason: `${sharedIntent}${detail}.` };
}
