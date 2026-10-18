import type { ParticipantProfile } from "../../participant/participant.entity";
import type { MatchCandidate } from "../match-strategy";
import { isMutualInterest } from "../scoring-config";
import type { Scorer } from "../scorers/scorer";

/**
 * Scores each candidate for the viewer, and the viewer for each candidate.
 * The forward score ranks; both directions decide mutual interest.
 */
export class ScoreStage {
  constructor(private readonly scorers: Scorer[]) {}

  execute(viewer: ParticipantProfile, candidates: ParticipantProfile[]): MatchCandidate[] {
    return candidates.map((participant) => {
      const { total: forward, breakdown } = this.pairScore(viewer, participant);
      const { total: reverse } = this.pairScore(participant, viewer);
      return {
        participant,
        score: Math.round(forward * 100),
        scoreBreakdown: { ...breakdown, reverse },
        mutualInterest: isMutualInterest(forward, reverse),
        reason: null,
      };
    }).sort((a, b) => b.score - a.score);
  }

  /** How well `candidate` fits `viewer`, 0–1, with each scorer's part. */
  pairScore(viewer: ParticipantProfile, candidate: ParticipantProfile): { total: number; breakdown: Record<string, number> } {
    const breakdown = Object.fromEntries(this.scorers.map((scorer) => [scorer.name, clamp(scorer.score(viewer, candidate))]));
    const totalWeight = this.scorers.reduce((sum, scorer) => sum + scorer.weight, 0) || 1;
    const total = this.scorers.reduce((sum, scorer) => sum + breakdown[scorer.name] * scorer.weight, 0) / totalWeight;
    return { total, breakdown };
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
