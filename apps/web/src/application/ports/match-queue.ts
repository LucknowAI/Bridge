import type { JobSnapshot } from "../../domain/matching/match-status";

/** Read side of the background matching queue. */
export interface MatchQueue {
  latestJob(eventId: string, participantId: string): Promise<JobSnapshot | null>;
  latestJobsForEvent(eventId: string): Promise<JobSnapshot[]>;
}
