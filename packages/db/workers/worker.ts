import "dotenv/config";
import { assertEnv } from "../../../apps/web/src/lib/env";
import { closePool } from "../src/client";
import { processEmbedJob } from "./embed.worker";
import { processMatchJob } from "./match.worker";
import { sweepIfDue } from "./housekeeping.worker";
import { processNotification } from "./notification.worker";
import { reportHealthIfDue } from "./metrics.worker";
import { getContainer } from "../../../apps/web/src/composition/container";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  assertEnv("worker");
  console.info(`[worker] embedding and matching queue started (version ${process.env.APP_VERSION || "dev"})`);
  while (!stopping) {
    await sweepIfDue();
    await reportHealthIfDue(getContainer().metrics);
    const embedded = await processEmbedJob();
    const matched = await processMatchJob();
    const notified = await processNotification();
    if (!embedded && !matched && !notified) await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  await closePool();
  console.info("[worker] stopped");
}

main().catch(async (error) => {
  console.error("[worker] fatal error", error);
  await closePool().catch(() => {});
  process.exit(1);
});
