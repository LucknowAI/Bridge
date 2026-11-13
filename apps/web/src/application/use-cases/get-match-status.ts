import { queueState, summarizeQueue } from "../../domain/matching/match-status";
import type { MatchQueue } from "../ports/match-queue";

export async function getMatchStatus(input: { eventId: string; participantId: string }, queue: MatchQueue) {
  return queueState(await queue.latestJob(input.eventId, input.participantId));
}

export async function getEventQueueSummary(input: { eventId: string }, queue: MatchQueue) {
  return summarizeQueue(await queue.latestJobsForEvent(input.eventId));
}
