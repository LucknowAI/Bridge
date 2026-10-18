import { events, matchingJobs } from "../src/index";
import { getContainer } from "../../../apps/web/src/composition/container";
import { profileText } from "../../../apps/web/src/domain/participant/participant.entity";
import { eventAllows } from "../../../apps/web/src/domain/shared/event-lifecycle";

export async function processEmbedJob(): Promise<boolean> {
  const job = await matchingJobs.claim("embed");
  if (!job) return false;
  try {
    const status = await events.statusOf(job.event_id);
    if (!status || !eventAllows(status, "processJob")) {
      console.info(`[worker:embed] job ${job.id} skipped: event is ${status ?? "gone"}`);
      await matchingJobs.complete(job.id);
      return true;
    }
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
