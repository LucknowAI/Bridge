import { matchingJobs } from "../src/index";
import { getContainer } from "../../../apps/web/src/composition/container";
import { computeMatches } from "../../../apps/web/src/application/use-cases/compute-matches";

export async function processMatchJob(): Promise<boolean> {
  const job = await matchingJobs.claim("match");
  if (!job) return false;
  try {
    const { pipeline } = getContainer();
    await computeMatches({ eventId: job.event_id, participantId: job.participant_id }, pipeline);
    await matchingJobs.complete(job.id);
  } catch (error) {
    console.error(`[worker:match] job ${job.id} failed`, error);
    await matchingJobs.fail(job.id);
  }
  return true;
}
