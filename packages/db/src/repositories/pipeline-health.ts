import { query } from "../client";

/** Backlog and failure counts of the background queues, for metrics and alarms. */
export interface PipelineHealth {
  jobsPending: number;
  /** Age of the oldest job that is due but not picked up; 0 when none. */
  oldestDueJobSeconds: number;
  /** Jobs that failed after every retry, in the last day. */
  jobsFailed: number;
  notificationsPending: number;
  oldestDueNotificationSeconds: number;
  notificationsFailed: number;
}

export async function snapshot(): Promise<PipelineHealth> {
  const { rows: [row] } = await query<Record<keyof PipelineHealth, string>>(
    `select
       (select count(*) from matching_jobs where status = 'pending') as "jobsPending",
       (select coalesce(extract(epoch from now() - min(available_at)), 0) from matching_jobs
         where status = 'pending' and available_at <= now()) as "oldestDueJobSeconds",
       (select count(*) from matching_jobs where status = 'failed'
         and coalesce(started_at, created_at) > now() - interval '1 day') as "jobsFailed",
       (select count(*) from notification_outbox where status = 'pending') as "notificationsPending",
       (select coalesce(extract(epoch from now() - min(available_at)), 0) from notification_outbox
         where status = 'pending' and available_at <= now()) as "oldestDueNotificationSeconds",
       (select count(*) from notification_outbox where status = 'failed'
         and created_at > now() - interval '1 day') as "notificationsFailed"`
  );
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Math.round(Number(value))])) as unknown as PipelineHealth;
}
