import { matchingJobs } from "../src/index";
import { getContainer } from "../../../apps/web/src/composition/container";
import { profileText } from "../../../apps/web/src/domain/participant/participant.entity";

export async function processEmbedJob(): Promise<boolean> {
  const job = await matchingJobs.claim("embed");
  if (!job) return false;
  try {
    const container = getContainer();
    const profile = await container.participants.findProfile(job.event_id, job.participant_id);
    if (profile) {
      const embedding = await container.embeddings.embed(profileText(profile), "profile");
      if (embedding) await container.participants.setEmbedding(job.event_id, job.participant_id, embedding);
    }
    await matchingJobs.complete(job.id);
    await matchingJobs.enqueue(job.event_id, job.participant_id, "match");
  } catch (error) {
    console.error(`[worker:embed] job ${job.id} failed`, error);
    await matchingJobs.fail(job.id);
  }
  return true;
}
