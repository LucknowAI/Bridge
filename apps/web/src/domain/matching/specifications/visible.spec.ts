import type { ParticipantProfile } from "../../participant/participant.entity";
import type { Specification } from "./specification";

export class VisibleSpecification implements Specification<ParticipantProfile> {
  isSatisfiedBy(candidate: ParticipantProfile): boolean {
    return candidate.visible;
  }
}
