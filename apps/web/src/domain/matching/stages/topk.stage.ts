import type { MatchCandidate } from "../match-strategy";

export class TopKStage {
  execute(candidates: MatchCandidate[], limit = 12): MatchCandidate[] {
    return candidates.slice(0, Math.max(0, Math.min(50, limit)));
  }
}
