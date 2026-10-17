import type { LlmProvider } from "../../../application/ports/llm-provider";
import type { ParticipantProfile } from "../../participant/participant.entity";
import type { MatchCandidate } from "../match-strategy";

export class LlmRerankStage {
  constructor(private readonly provider: LlmProvider | null) {}

  async execute(viewer: ParticipantProfile, candidates: MatchCandidate[]): Promise<MatchCandidate[]> {
    if (!this.provider || candidates.length === 0) return candidates.map(addFallbackReason);
    try {
      return await this.provider.rerank(viewer, candidates);
    } catch (error) {
      console.warn("[matching] LLM rerank unavailable; using scored order", error);
      return candidates.map(addFallbackReason);
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
