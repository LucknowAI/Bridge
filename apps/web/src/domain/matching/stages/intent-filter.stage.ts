import type { ParticipantProfile } from "../../participant/participant.entity";
import { IntentCompatibleSpecification } from "../specifications/intent-compatible.spec";
import { VisibleSpecification } from "../specifications/visible.spec";

export class IntentFilterStage {
  execute(viewer: ParticipantProfile, candidates: ParticipantProfile[]): ParticipantProfile[] {
    const intent = new IntentCompatibleSpecification(viewer.intent);
    const visible = new VisibleSpecification();
    return candidates.filter((candidate) => intent.isSatisfiedBy(candidate) && visible.isSatisfiedBy(candidate));
  }
}
