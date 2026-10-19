import { events, matchingJobs } from "../src/index";
import { getContainer } from "../../../apps/web/src/composition/container";
import { computeMatches } from "../../../apps/web/src/application/use-cases/compute-matches";
import { StaleRevisionError } from "../../../apps/web/src/domain/matching/pipeline";
import { eventAllows } from "../../../apps/web/src/domain/shared/event-lifecycle";

export async function processMatchJob(): Promise<boolean> {
  const job = await matchingJobs.claim("match");
  if (!job) return false;
  try {
    const status = await events.statusOf(job.event_id);
    if (!status || !eventAllows(status, "processJob")) {
      console.info(`[worker:match] job ${job.id} skipped: event is ${status ?? "gone"}`);
      await matchingJobs.complete(job.id);
      return true;
    }
    const { pipeline } = getContainer();
    await computeMatches({ eventId: job.event_id, participantId: job.participant_id, expectedRevision: job.revision }, pipeline);
    await matchingJobs.complete(job.id);
  } catch (error) {
    if (error instanceof StaleRevisionError) {
      // The profile moved on during this run; the newer job publishes instead.
      await matchingJobs.complete(job.id);
      return true;
    }
    console.error(`[worker:match] job ${job.id} failed`, error);
    await matchingJobs.fail(job.id, error instanceof Error ? error.message : String(error));
  }
  return true;
}
