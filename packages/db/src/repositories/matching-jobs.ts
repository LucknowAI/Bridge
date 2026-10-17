import { query, transaction } from "../client";

export interface MatchingJob {
  id: number;
  event_id: string;
  participant_id: string;
  attempts: number;
  job_type: "embed" | "match";
}

export async function enqueue(eventId: string, participantId: string, jobType: "embed" | "match" = "match"): Promise<void> {
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
       update matching_jobs j set status = 'running', attempts = attempts + 1
        from next_job where j.id = next_job.id
       returning j.id, j.event_id, j.participant_id, j.attempts, j.job_type`, [jobType]
    );
    return rows[0] ?? null;
  });
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
