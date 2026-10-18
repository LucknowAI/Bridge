import { matchingJobs } from "@match-maker/db";
import type { MatchQueue } from "../../application/ports/match-queue";
import type { JobSnapshot } from "../../domain/matching/match-status";

export class PostgresMatchQueue implements MatchQueue {
  async latestJob(eventId: string, participantId: string): Promise<JobSnapshot | null> {
    const row = await matchingJobs.latestForParticipant(eventId, participantId);
    return row ? toSnapshot(row) : null;
  }

  async latestJobsForEvent(eventId: string): Promise<JobSnapshot[]> {
    return (await matchingJobs.latestForEvent(eventId)).map(toSnapshot);
  }
}

function toSnapshot(row: matchingJobs.JobSnapshot): JobSnapshot {
  return { type: row.job_type, status: row.status, startedAt: row.started_at };
}
