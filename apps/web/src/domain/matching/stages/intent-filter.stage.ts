import type { ParticipantProfile } from "../../participant/participant.entity";
import { CompleteProfileSpecification } from "../specifications/complete-profile.spec";
import { IntentCompatibleSpecification } from "../specifications/intent-compatible.spec";
import { VisibleSpecification } from "../specifications/visible.spec";

export class IntentFilterStage {
  execute(viewer: ParticipantProfile, candidates: ParticipantProfile[]): ParticipantProfile[] {
    const intent = new IntentCompatibleSpecification(viewer.intent);
    const visible = new VisibleSpecification();
    const complete = new CompleteProfileSpecification();
    return candidates.filter((candidate) =>
      intent.isSatisfiedBy(candidate) && visible.isSatisfiedBy(candidate) && complete.isSatisfiedBy(candidate));
  }
}
