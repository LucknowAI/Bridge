import type { ParticipantProfile } from "../../participant/participant.entity";
import { tokenize, type Scorer } from "./scorer";

export class JaccardScorer implements Scorer {
  readonly name = "interests";
  readonly weight = 0.2;
  score(viewer: ParticipantProfile, candidate: ParticipantProfile): number {
    const left = new Set([...viewer.interests, viewer.domain ?? ""].flatMap((v) => [...tokenize(v)]));
    const right = new Set([...candidate.interests, candidate.domain ?? ""].flatMap((v) => [...tokenize(v)]));
    if (!left.size || !right.size) return 0.4;
    const intersection = [...left].filter((word) => right.has(word)).length;
    return intersection / new Set([...left, ...right]).size;
  }
}
