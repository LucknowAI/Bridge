import type { ParticipantProfile } from "../../participant/participant.entity";
import { SCORING_CONFIG } from "../scoring-config";
import { tokenize, type Scorer } from "./scorer";

/**
 * Directional interest fit: how much of what the viewer cares about (their
 * interests and domain) the candidate shares. Unlike a symmetric overlap, a
 * narrow profile can fit a broad one well while the reverse fits poorly,
 * which is what lets score(A→B) and score(B→A) differ.
 */
export class InterestCoverageScorer implements Scorer {
  readonly name = "interests";
  readonly weight = SCORING_CONFIG.weights.interests;
  score(viewer: ParticipantProfile, candidate: ParticipantProfile): number {
    const wanted = new Set([...viewer.interests, viewer.domain ?? ""].flatMap((v) => [...tokenize(v)]));
    const offered = new Set([...candidate.interests, candidate.domain ?? ""].flatMap((v) => [...tokenize(v)]));
    if (!wanted.size || !offered.size) return 0.4;
    return [...wanted].filter((word) => offered.has(word)).length / wanted.size;
  }
}
