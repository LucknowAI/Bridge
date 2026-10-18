import { isIntentCompatible } from "../../participant/intent";
import { SCORING_CONFIG } from "../scoring-config";
import type { ParticipantProfile } from "../../participant/participant.entity";
import type { Scorer } from "./scorer";

export class IntentScorer implements Scorer {
  readonly name = "intent";
  readonly weight = SCORING_CONFIG.weights.intent;
  score(viewer: ParticipantProfile, candidate: ParticipantProfile): number {
    return isIntentCompatible(viewer.intent, candidate.intent) ? 1 : 0;
  }
}
