import type { LlmProvider } from "../../../application/ports/llm-provider";
import type { ParticipantProfile } from "../../participant/participant.entity";
import type { MatchCandidate } from "../match-strategy";
import type { ExplanationCache } from "../../../application/ports/explanation-cache";
import { EXPLANATION_TTL_SECONDS, explanationKey, shortlistKey } from "../explanation-key";

export interface RerankResult {
  candidates: MatchCandidate[];
  /** `llm:<provider id>` when the model ordered the list, `score` for the fallback. */
  rankedBy: string;
}

/**
 * Orders the shortlist with the model and explains each match. Explanations
 * are cached per viewer -> candidate pair: when every pair already has one,
 * the model is not called, and its earlier order for this exact shortlist is
 * reused (the scored order stands if there is none). A pair's cached reason
 * never decides an order.
 */
/** Below this much remaining time a rerank call is not worth starting. */
const MIN_RERANK_MS = 750;

export class LlmRerankStage {
  constructor(
    private readonly provider: LlmProvider | null,
    private readonly cache: ExplanationCache | null = null
  ) {}

  async execute(viewer: ParticipantProfile, candidates: MatchCandidate[], context = "profile", options: { timeoutMs?: number } = {}): Promise<RerankResult> {
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
    if (cached.size === candidates.length) return this.withStoredOrder(keys, withCached, provider.id);
    // Too little of the request's budget left for a model call: keep the scored order.
    if (options.timeoutMs !== undefined && options.timeoutMs < MIN_RERANK_MS) {
      return { candidates: withCached.map(addFallbackReason), rankedBy: "score" };
    }

    try {
      const reranked = await provider.rerank(viewer, candidates, { timeoutMs: options.timeoutMs });
      await this.writeCache(viewer, reranked.filter((candidate) => candidate.reason).map((candidate) => ({
        key: keyFor(candidate), candidateId: candidate.participant.attendeeId, reason: candidate.reason!,
      })), { key: shortlistKey(keys), candidateIds: reranked.map((candidate) => candidate.participant.attendeeId) });
      return { candidates: reranked.map(addFallbackReason), rankedBy: `llm:${provider.id}` };
    } catch (error) {
      console.warn("[matching] LLM rerank unavailable; using scored order", error);
      return { candidates: withCached.map(addFallbackReason), rankedBy: "score" };
    }
  }

  private async withStoredOrder(keys: string[], candidates: MatchCandidate[], providerId: string): Promise<RerankResult> {
    let order: string[] | null = null;
    try {
      order = await this.cache!.getOrder(shortlistKey(keys));
    } catch (error) {
      console.warn("[matching] explanation cache unavailable", error);
    }
    const position = new Map((order ?? []).map((id, index) => [id, index]));
    if (!order || !candidates.every((candidate) => position.has(candidate.participant.attendeeId))) {
      return { candidates, rankedBy: "score" };
    }
    const sorted = [...candidates].sort((a, b) => position.get(a.participant.attendeeId)! - position.get(b.participant.attendeeId)!);
    return { candidates: sorted, rankedBy: `llm:${providerId}` };
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

  private async writeCache(viewer: ParticipantProfile, entries: Array<{ key: string; candidateId: string; reason: string }>, order: { key: string; candidateIds: string[] }) {
    if (!this.cache || !entries.length) return;
    try {
      await this.cache.setMany(entries.map((entry) => ({ ...entry, eventId: viewer.eventId, viewerId: viewer.attendeeId })), EXPLANATION_TTL_SECONDS);
      await this.cache.setOrder({ ...order, eventId: viewer.eventId, viewerId: viewer.attendeeId }, EXPLANATION_TTL_SECONDS);
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
