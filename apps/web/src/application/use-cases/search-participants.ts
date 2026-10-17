import { MatchingPipeline } from "../../domain/matching/pipeline";
import type { RateLimiter } from "../ports/rate-limiter";

export async function searchParticipants(
  input: { eventId: string; participantId: string; query: string; limit?: number },
  dependencies: { pipeline: MatchingPipeline; limiter?: RateLimiter }
) {
  if (dependencies.limiter && !(await dependencies.limiter.consume(`search:${input.participantId}`, 30, 60))) {
    throw new Error("Too many searches. Wait a moment and try again.");
  }
  return dependencies.pipeline.run({ ...input, mode: "search" });
}
