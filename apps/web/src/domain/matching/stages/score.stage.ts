import { areIntentsMutuallyCompatible } from "../../participant/intent";
import type { ParticipantProfile } from "../../participant/participant.entity";
import type { MatchCandidate } from "../match-strategy";
import type { Scorer } from "../scorers/scorer";

export class ScoreStage {
  constructor(private readonly scorers: Scorer[]) {}

  execute(viewer: ParticipantProfile, candidates: ParticipantProfile[]): MatchCandidate[] {
    return candidates.map((participant) => {
      const scoreBreakdown = Object.fromEntries(
        this.scorers.map((scorer) => [scorer.name, clamp(scorer.score(viewer, participant))])
      );
      const totalWeight = this.scorers.reduce((sum, scorer) => sum + scorer.weight, 0) || 1;
      const score = this.scorers.reduce(
        (sum, scorer) => sum + scoreBreakdown[scorer.name] * scorer.weight,
        0
      ) / totalWeight;

      return {
        participant,
        score: Math.round(score * 100),
        scoreBreakdown,
        mutualInterest: areIntentsMutuallyCompatible(viewer.intent, participant.intent),
        reason: null,
      };
    }).sort((a, b) => b.score - a.score);
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
