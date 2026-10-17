import { MatchingPipeline } from "../../domain/matching/pipeline";

export function computeMatches(input: { eventId: string; participantId: string; limit?: number }, pipeline: MatchingPipeline) {
  return pipeline.run({ ...input, mode: "profile" });
}
