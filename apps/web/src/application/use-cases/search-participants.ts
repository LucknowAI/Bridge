import { MatchingPipeline } from "../../domain/matching/pipeline";
import { normalizeFilters } from "../../domain/matching/search-query";
import type { ParticipantRepository } from "../ports/participant-repository";
import type { RateLimiter } from "../ports/rate-limiter";
import { boundedText, LIMITS } from "../../domain/shared/validation";

export async function searchParticipants(
  input: { eventId: string; participantId: string; query: string; eventIntents: string[]; filters?: { intent?: string | null; domain?: string | null }; limit?: number },
  dependencies: { pipeline: MatchingPipeline; participants: ParticipantRepository; limiter?: RateLimiter }
) {
  if (dependencies.limiter && !(await dependencies.limiter.consume(`search:${input.participantId}`, 30, 60))) {
    throw new Error("Too many searches. Wait a moment and try again.");
  }
  const query = boundedText(input.query, "query", "Search", LIMITS.searchQuery, { required: true })!;
  const filters = normalizeFilters(input.filters ?? {}, {
    intents: input.eventIntents,
    domains: input.filters?.domain ? await dependencies.participants.listDomains(input.eventId) : [],
  });
  return dependencies.pipeline.run({ eventId: input.eventId, participantId: input.participantId, query, filters, limit: input.limit, mode: "search" });
}
