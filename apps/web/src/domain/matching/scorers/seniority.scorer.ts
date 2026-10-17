import type { ParticipantProfile } from "../../participant/participant.entity";
import type { Scorer } from "./scorer";

export class SeniorityScorer implements Scorer {
  readonly name = "seniority";
  readonly weight = 0.05;
  score(viewer: ParticipantProfile, candidate: ParticipantProfile): number {
    if (viewer.yearsOfExperience == null || candidate.yearsOfExperience == null) return 0.5;
    return Math.max(0.25, 1 - Math.abs(viewer.yearsOfExperience - candidate.yearsOfExperience) / 20);
  }
}
