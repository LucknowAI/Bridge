import { MatchingPipeline } from "../../domain/matching/pipeline";
import type { RateLimiter } from "../ports/rate-limiter";
import { boundedText, LIMITS } from "../../domain/shared/validation";

export async function searchParticipants(
  input: { eventId: string; participantId: string; query: string; limit?: number },
  dependencies: { pipeline: MatchingPipeline; limiter?: RateLimiter }
) {
  if (dependencies.limiter && !(await dependencies.limiter.consume(`search:${input.participantId}`, 30, 60))) {
    throw new Error("Too many searches. Wait a moment and try again.");
  }
  const query = boundedText(input.query, "query", "Search", LIMITS.searchQuery, { required: true })!;
  return dependencies.pipeline.run({ ...input, query, mode: "search" });
}
