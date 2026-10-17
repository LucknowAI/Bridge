import { isIntentCompatible } from "../../participant/intent";
import type { ParticipantProfile } from "../../participant/participant.entity";
import type { Specification } from "./specification";

export class IntentCompatibleSpecification implements Specification<ParticipantProfile> {
  constructor(private readonly intent: ParticipantProfile["intent"]) {}
  isSatisfiedBy(candidate: ParticipantProfile): boolean {
    return isIntentCompatible(this.intent, candidate.intent);
  }
}
