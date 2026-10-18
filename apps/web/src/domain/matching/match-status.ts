/**
 * Where background matching stands for one participant, derived from their
 * latest job. Lets the UI tell "still working" apart from "failed" and from
 * "finished with nobody to match".
 */
export type QueueState = "none" | "queued" | "running" | "stuck" | "failed" | "done";

/** A running job older than this is treated as stuck (crashed worker). */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

export interface JobSnapshot {
  type: "embed" | "match";
  status: "pending" | "running" | "done" | "failed";
  startedAt: Date | null;
}

export function queueState(job: JobSnapshot | null, now = Date.now()): QueueState {
  if (!job) return "none";
  switch (job.status) {
    case "pending":
      return "queued";
    case "running":
      return job.startedAt && now - job.startedAt.getTime() > STUCK_AFTER_MS ? "stuck" : "running";
    case "failed":
      return "failed";
    case "done":
      // A finished embed job is immediately followed by its match job.
      return job.type === "embed" ? "queued" : "done";
  }
}

/** True while results may still change without anyone acting. */
export function isInProgress(state: QueueState): boolean {
  return state === "queued" || state === "running";
}

export function summarizeQueue(jobs: JobSnapshot[], now = Date.now()): Record<Exclude<QueueState, "none">, number> {
  const counts = { queued: 0, running: 0, stuck: 0, failed: 0, done: 0 };
  for (const job of jobs) {
    const state = queueState(job, now);
    if (state !== "none") counts[state] += 1;
  }
  return counts;
}
