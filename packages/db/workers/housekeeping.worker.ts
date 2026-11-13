import { housekeeping } from "../src/index";

export const SWEEP_EVERY_MS = 60 * 60 * 1000;

let lastSweep = 0;

/** Runs the expired-row sweep at most once per SWEEP_EVERY_MS; the first call sweeps immediately. */
export async function sweepIfDue(now = Date.now()): Promise<boolean> {
  if (now - lastSweep < SWEEP_EVERY_MS) return false;
  lastSweep = now;
  try {
    const removed = await housekeeping.sweepExpired();
    console.info("[worker:housekeeping] removed expired rows", removed);
  } catch (error) {
    // Housekeeping must never stop matching; the next hour tries again.
    console.error("[worker:housekeeping] sweep failed", error);
  }
  return true;
}
