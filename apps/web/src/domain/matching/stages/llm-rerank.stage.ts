import type { LlmProvider } from "../../../application/ports/llm-provider";
import type { ParticipantProfile } from "../../participant/participant.entity";
import type { MatchCandidate } from "../match-strategy";
import type { ExplanationCache } from "../../../application/ports/explanation-cache";
import { EXPLANATION_TTL_SECONDS, explanationKey } from "../explanation-key";

export interface RerankResult {
  candidates: MatchCandidate[];
  /** `llm:<provider id>` when the model ordered the list, `score` for the fallback. */
  rankedBy: string;
}

/**
 * Orders the shortlist with the model and explains each match. Explanations
 * are cached per viewer -> candidate pair: when every pair already has one,
 * the model is not called and the scored order stands. A cached reason never
 * decides the order of a shortlist.
 */
export class LlmRerankStage {
  constructor(
    private readonly provider: LlmProvider | null,
    private readonly cache: ExplanationCache | null = null
  ) {}

  async execute(viewer: ParticipantProfile, candidates: MatchCandidate[], context = "profile"): Promise<RerankResult> {
    const scored = { candidates: candidates.map(addFallbackReason), rankedBy: "score" };
    if (!this.provider || candidates.length === 0) return scored;
    const provider = this.provider;
    const keyFor = (candidate: MatchCandidate) => explanationKey({
      eventId: viewer.eventId, viewer, candidate: candidate.participant,
      model: provider.id, promptVersion: provider.promptVersion, context,
    });
    const keys = candidates.map(keyFor);
    const cached = await this.readCache(keys);
    const withCached = candidates.map((candidate, index) => ({ ...candidate, reason: cached.get(keys[index]) ?? candidate.reason }));
    if (cached.size === candidates.length) return { candidates: withCached, rankedBy: "score" };

    try {
      const reranked = await provider.rerank(viewer, candidates);
      await this.writeCache(viewer, reranked.filter((candidate) => candidate.reason).map((candidate) => ({
        key: keyFor(candidate), candidateId: candidate.participant.attendeeId, reason: candidate.reason!,
      })));
      return { candidates: reranked.map(addFallbackReason), rankedBy: `llm:${provider.id}` };
    } catch (error) {
      console.warn("[matching] LLM rerank unavailable; using scored order", error);
      return { candidates: withCached.map(addFallbackReason), rankedBy: "score" };
    }
  }

  private async readCache(keys: string[]): Promise<Map<string, string>> {
    if (!this.cache) return new Map();
    try {
      return await this.cache.getMany(keys);
    } catch (error) {
      console.warn("[matching] explanation cache unavailable", error);
      return new Map();
    }
  }

  private async writeCache(viewer: ParticipantProfile, entries: Array<{ key: string; candidateId: string; reason: string }>) {
    if (!this.cache || !entries.length) return;
    try {
      await this.cache.setMany(entries.map((entry) => ({ ...entry, eventId: viewer.eventId, viewerId: viewer.attendeeId })), EXPLANATION_TTL_SECONDS);
    } catch (error) {
      console.warn("[matching] could not cache explanations", error);
    }
  }
}

function addFallbackReason(candidate: MatchCandidate): MatchCandidate {
  if (candidate.reason) return candidate;
  const person = candidate.participant;
  const sharedIntent = candidate.mutualInterest
    ? "You look like a strong fit for each other"
    : "Their background adds a complementary perspective";
  const detail = person.domain ? ` in ${person.domain}` : "";
  return { ...candidate, reason: `${sharedIntent}${detail}.` };
}
