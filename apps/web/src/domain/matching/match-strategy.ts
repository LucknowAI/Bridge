import type { ParticipantProfile } from "../participant/participant.entity";

export interface MatchCandidate {
  participant: ParticipantProfile;
  score: number;
  scoreBreakdown: Record<string, number>;
  mutualInterest: boolean;
  reason: string | null;
}

export interface MatchStrategy {
  rank(viewer: ParticipantProfile, candidates: ParticipantProfile[]): MatchCandidate[];
}

export const DEFAULT_MATCH_LIMIT = 12;
