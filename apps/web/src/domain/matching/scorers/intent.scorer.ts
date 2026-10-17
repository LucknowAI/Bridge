import { isIntentCompatible } from "../../participant/intent";
import type { ParticipantProfile } from "../../participant/participant.entity";
import type { Scorer } from "./scorer";

export class IntentScorer implements Scorer {
  readonly name = "intent";
  readonly weight = 0.25;
  score(viewer: ParticipantProfile, candidate: ParticipantProfile): number {
    return isIntentCompatible(viewer.intent, candidate.intent) ? 1 : 0;
  }
}
