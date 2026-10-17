import type { MatchRepository } from "../ports/match-repository";

export function getMyMatches(input: { eventId: string; participantId: string; limit?: number }, matches: MatchRepository) {
  return matches.listForParticipant(input.eventId, input.participantId, input.limit ?? 50);
}
