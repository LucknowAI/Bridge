import type { ParticipantProfile } from "../../participant/participant.entity";
import type { Specification } from "./specification";

/** A profile counts as complete once the participant has saved it for the event. */
export class CompleteProfileSpecification implements Specification<ParticipantProfile> {
  isSatisfiedBy(candidate: ParticipantProfile): boolean {
    return candidate.profileComplete === true;
  }
}
