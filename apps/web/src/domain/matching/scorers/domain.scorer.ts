import { SCORING_CONFIG } from "../scoring-config";
import type { ParticipantProfile } from "../../participant/participant.entity";
import type { Scorer } from "./scorer";

export class DomainScorer implements Scorer {
  readonly name = "domain";
  readonly weight = SCORING_CONFIG.weights.domain;
  score(viewer: ParticipantProfile, candidate: ParticipantProfile): number {
    const a = viewer.domain?.trim().toLowerCase();
    const b = candidate.domain?.trim().toLowerCase();
    if (!a || !b) return 0.45;
    return a === b ? 1 : 0.55;
  }
}
