/**
 * Inspect and retry background matching jobs that failed for good:
 *
 *   npm run jobs:failed               list them with their last error
 *   npm run jobs:retry -- <id|all>    queue them again with fresh attempts
 */
import "dotenv/config";
import { closePool, matchingJobs } from "@match-maker/db";
import { isMainModule } from "../packages/db/src/is-main";

if (isMainModule(import.meta.url)) {
  const [command, target] = process.argv.slice(2);
  try {
    if (command === "failed") {
      const failed = await matchingJobs.listFailed();
      if (!failed.length) console.info("[jobs] no failed jobs");
      for (const job of failed) {
        console.info(`[jobs] #${job.id} ${job.event_slug} ${job.email ?? "(erased)"} ${job.job_type} after ${job.attempts} attempts: ${job.last_error ?? "no error recorded"}`);
      }
    } else if (command === "retry" && (target === "all" || /^\d+$/.test(target ?? ""))) {
      const count = await matchingJobs.retryFailed(target === "all" ? "all" : Number(target));
      console.info(`[jobs] queued ${count} job(s) again`);
    } else {
      console.error("Usage: tsx tools/manage-jobs.ts failed | retry <id|all>");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[jobs] ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
