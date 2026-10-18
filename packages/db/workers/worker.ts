import "dotenv/config";
import { assertEnv } from "../../../apps/web/src/lib/env";
import { closePool } from "../src/client";
import { processEmbedJob } from "./embed.worker";
import { processMatchJob } from "./match.worker";
import { sweepIfDue } from "./housekeeping.worker";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  assertEnv("worker");
  console.info("[worker] embedding and matching queue started");
  while (!stopping) {
    await sweepIfDue();
    const embedded = await processEmbedJob();
    const matched = await processMatchJob();
    if (!embedded && !matched) await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  await closePool();
  console.info("[worker] stopped");
}

main().catch(async (error) => {
  console.error("[worker] fatal error", error);
  await closePool().catch(() => {});
  process.exit(1);
});
