import { closePool } from "../src/client";
import { processEmbedJob } from "./embed.worker";
import { processMatchJob } from "./match.worker";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  console.info("[worker] embedding and matching queue started");
  while (!stopping) {
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
