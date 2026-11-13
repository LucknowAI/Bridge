/**
 * Model usage, reliability and approximate cost for the last N hours:
 *
 *   npm run models:usage [-- <hours>]
 *
 * Set MODEL_PRICE_PER_1K_TOKENS (USD) to include an estimated cost.
 */
import "dotenv/config";
import { closePool, modelUsage } from "@match-maker/db";
import { isMainModule } from "../packages/db/src/is-main";

if (isMainModule(import.meta.url)) {
  const hours = Number(process.argv[2] ?? 24);
  const price = Number(process.env.MODEL_PRICE_PER_1K_TOKENS ?? NaN);
  try {
    const rows = await modelUsage.summary(Number.isFinite(hours) && hours > 0 ? hours : 24);
    if (!rows.length) console.info(`[usage] no model calls in the last ${hours} hours`);
    for (const row of rows) {
      const cost = Number.isFinite(price) ? ` ~$${((row.approx_tokens / 1000) * price).toFixed(4)}` : "";
      console.info(`[usage] ${row.provider} ${row.operation}: ${row.calls} calls, ${row.failures} failed, avg ${row.avg_latency_ms} ms, p95 ${row.p95_latency_ms} ms, ~${row.approx_tokens} tokens${cost}`);
    }
  } catch (error) {
    console.error(`[usage] ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
