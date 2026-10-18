/**
 * The scoring configuration: scorer weights and the mutual-interest rule.
 * Bump `version` whenever a weight, scorer or the threshold changes; it is
 * part of the persisted computation version, so matches computed under an
 * older configuration can be found and recomputed.
 */
export const SCORING_CONFIG = {
  version: "s2",
  weights: {
    semantic: 0.3,
    intent: 0.25,
    interests: 0.2,
    domain: 0.15,
    complementarity: 0.05,
    seniority: 0.05,
  },
  /**
   * Mutual interest means each person is a strong fit for the other: both
   * directional scores, score(A→B) and score(B→A), reach this value (0–1).
   * Calibrated on the examples in tests/unit/mutual-interest.test.ts. With
   * these weights, compatible goals plus a shared domain already reach about
   * 0.55, so 0.65 requires real interest overlap: a pair sharing domain and
   * interests scores about 0.75 both ways, a one-way fit about 0.75 and 0.63,
   * and compatible goals alone about 0.48.
   */
  mutualInterestThreshold: 0.65,
} as const;

export type ScorerName = keyof typeof SCORING_CONFIG.weights;

export function isMutualInterest(forward: number, reverse: number, threshold: number = SCORING_CONFIG.mutualInterestThreshold): boolean {
  return forward >= threshold && reverse >= threshold;
}
