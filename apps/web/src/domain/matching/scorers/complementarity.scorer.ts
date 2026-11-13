import { areIntentsMutuallyCompatible } from "../../participant/intent";
import { SCORING_CONFIG } from "../scoring-config";
import type { ParticipantProfile } from "../../participant/participant.entity";
import type { Scorer } from "./scorer";

export class ComplementarityScorer implements Scorer {
  readonly name = "complementarity";
  readonly weight = SCORING_CONFIG.weights.complementarity;
  score(viewer: ParticipantProfile, candidate: ParticipantProfile): number {
    if (areIntentsMutuallyCompatible(viewer.intent, candidate.intent)) return 1;
    return viewer.domain && candidate.domain && viewer.domain !== candidate.domain ? 0.7 : 0.45;
  }
}
