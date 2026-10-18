import { query, transaction } from "../client";

export interface MatchingJob {
  id: number;
  event_id: string;
  participant_id: string;
  attempts: number;
  job_type: "embed" | "match";
}

/** Matches STUCK_AFTER_MS in apps/web/src/domain/matching/match-status.ts. */
const STUCK_AFTER_MINUTES = 10;

export async function enqueue(eventId: string, participantId: string, jobType: "embed" | "match" = "match"): Promise<void> {
  // A job "running" past the stuck limit belongs to a crashed worker and would
  // block the one-active-job index forever; release it so this request queues.
  await query(
    `update matching_jobs set status = 'failed'
      where event_id = $1 and participant_id = $2 and job_type = $3 and status = 'running'
        and started_at < now() - make_interval(mins => $4)`,
    [eventId, participantId, jobType, STUCK_AFTER_MINUTES]
  );
  await query(
    `insert into matching_jobs (event_id, participant_id, job_type) values ($1, $2, $3)
     on conflict (event_id, participant_id, job_type) where status in ('pending', 'running') do nothing`,
    [eventId, participantId, jobType]
  );
}

/** Claim one row safely when multiple worker replicas run at once. */
export async function claim(jobType: "embed" | "match"): Promise<MatchingJob | null> {
  return transaction(async (client) => {
    const { rows } = await client.query<MatchingJob>(
      `with next_job as (
         select id from matching_jobs
          where job_type = $1 and status in ('pending', 'failed') and available_at <= now() and attempts < 5
          order by created_at asc for update skip locked limit 1
       )
       update matching_jobs j set status = 'running', attempts = attempts + 1, started_at = now()
        from next_job where j.id = next_job.id
       returning j.id, j.event_id, j.participant_id, j.attempts, j.job_type`, [jobType]
    );
    return rows[0] ?? null;
  });
}

/** A job's state as shown to people: the latest job says where matching stands. */
export interface JobSnapshot {
  participant_id: string;
  job_type: "embed" | "match";
  status: "pending" | "running" | "done" | "failed";
  started_at: Date | null;
}

const LATEST_ORDER = "created_at desc, id desc";

export async function latestForParticipant(eventId: string, participantId: string): Promise<JobSnapshot | null> {
  const { rows } = await query<JobSnapshot>(
    `select participant_id, job_type, status, started_at from matching_jobs
      where event_id = $1 and participant_id = $2
      order by ${LATEST_ORDER} limit 1`,
    [eventId, participantId]
  );
  return rows[0] ?? null;
}

/** The latest job of every participant in the event that has one. */
export async function latestForEvent(eventId: string): Promise<JobSnapshot[]> {
  const { rows } = await query<JobSnapshot>(
    `select distinct on (participant_id) participant_id, job_type, status, started_at from matching_jobs
      where event_id = $1
      order by participant_id, ${LATEST_ORDER}`,
    [eventId]
  );
  return rows;
}

export async function complete(id: number): Promise<void> {
  await query(`update matching_jobs set status = 'done' where id = $1`, [id]);
}

export async function fail(id: number, retrySeconds = 30): Promise<void> {
  await query(
    `update matching_jobs
        set status = case when attempts >= 5 then 'failed' else 'pending' end,
            available_at = now() + ($2 || ' seconds')::interval
      where id = $1`,
    [id, String(retrySeconds)]
  );
}
