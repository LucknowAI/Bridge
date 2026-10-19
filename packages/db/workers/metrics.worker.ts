import { pipelineHealth } from "../src/index";
import type { Metrics } from "../../../apps/web/src/application/ports/metrics";

export const REPORT_EVERY_MS = 60 * 1000;

let lastReport = 0;

/**
 * Reports queue backlog and failures once a minute. WorkerHeartbeat doubles
 * as liveness: when it stops arriving, the worker is down.
 */
export async function reportHealthIfDue(metrics: Metrics, now = Date.now()): Promise<boolean> {
  if (now - lastReport < REPORT_EVERY_MS) return false;
  lastReport = now;
  try {
    const health = await pipelineHealth.snapshot();
    metrics.record([
      { name: "WorkerHeartbeat", value: 1, unit: "Count" },
      { name: "JobsPending", value: health.jobsPending, unit: "Count" },
      { name: "OldestDueJobSeconds", value: health.oldestDueJobSeconds, unit: "Seconds" },
      { name: "JobsFailed", value: health.jobsFailed, unit: "Count" },
      { name: "NotificationsPending", value: health.notificationsPending, unit: "Count" },
      { name: "OldestDueNotificationSeconds", value: health.oldestDueNotificationSeconds, unit: "Seconds" },
      { name: "NotificationsFailed", value: health.notificationsFailed, unit: "Count" },
    ]);
  } catch (error) {
    // A missing heartbeat raises the alarm; the queues keep running.
    console.error("[worker:metrics] could not read queue health", error);
  }
  return true;
}
