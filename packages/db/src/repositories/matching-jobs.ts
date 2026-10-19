import { query, transaction } from "../client";

export interface MatchingJob {
  id: number;
  event_id: string;
  participant_id: string;
  attempts: number;
  job_type: "embed" | "match";
  /** The profile revision this job must reflect. */
  revision: number;
  trigger_kind: "profile" | "refresh";
}

/** Attempts before a job fails for good. */
export const MAX_ATTEMPTS = 5;
/** How long a claimed job may run before another worker may take it over. */
export const LEASE_SECONDS = 300;

/**
 * Queues work for a participant. At most one job per person and kind is
 * pending: a newer request updates it (latest revision, earliest start, and
 * "profile" wins over "refresh") instead of being dropped, and a running job
 * no longer blocks a new one. Without a revision, the participant's current
 * one is used.
 */
export async function enqueue(
  eventId: string,
  participantId: string,
  jobType: "embed" | "match" = "match",
  options: { revision?: number; trigger?: "profile" | "refresh"; delaySeconds?: number } = {},
  client: { query: typeof query } = { query }
): Promise<void> {
  await client.query(
    `insert into matching_jobs (event_id, participant_id, job_type, revision, trigger_kind, available_at)
     values ($1, $2, $3,
             coalesce($4::bigint, (select profile_revision from event_participants where event_id = $1 and attendee_id = $2), 0),
             $5, now() + make_interval(secs => $6))
     on conflict (event_id, participant_id, job_type) where status = 'pending' do update
       set revision = greatest(matching_jobs.revision, excluded.revision),
           available_at = least(matching_jobs.available_at, excluded.available_at),
           trigger_kind = case when matching_jobs.trigger_kind = 'profile' then 'profile' else excluded.trigger_kind end`,
    [eventId, participantId, jobType, options.revision ?? null, options.trigger ?? "profile", options.delaySeconds ?? 0]
  );
}

/**
 * Claims the oldest due job of a kind, safely across worker replicas: a
 * pending job whose time has come, or a running one whose lease expired
 * (its worker crashed). A crashed job already at its last attempt fails
 * for good instead of being retried forever.
 */
export async function claim(jobType: "embed" | "match", onlyEventId: string | null = null): Promise<MatchingJob | null> {
  return transaction(async (client) => {
    await client.query(
      `update matching_jobs set status = 'failed', lease_until = null, last_error = coalesce(last_error, 'worker stopped responding')
        where job_type = $1 and status = 'running' and lease_until < now() and attempts >= $2
          and ($3::uuid is null or event_id = $3)`,
      [jobType, MAX_ATTEMPTS, onlyEventId]
    );
    const { rows } = await client.query<MatchingJob>(
      `with next_job as (
         select id from matching_jobs
          where job_type = $1 and attempts < $2 and ($4::uuid is null or event_id = $4)
            and ((status = 'pending' and available_at <= now()) or (status = 'running' and lease_until < now()))
          order by available_at asc, created_at asc for update skip locked limit 1
       )
       update matching_jobs j set status = 'running', attempts = attempts + 1, started_at = now(),
              lease_until = now() + make_interval(secs => $3)
        from next_job where j.id = next_job.id
       returning j.id::int as id, j.event_id, j.participant_id, j.attempts, j.job_type, j.revision::int as revision, j.trigger_kind`,
      [jobType, MAX_ATTEMPTS, LEASE_SECONDS, onlyEventId]
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
  await query(`update matching_jobs set status = 'done', lease_until = null where id = $1`, [id]);
}

/** Delay before retry `attempt` (1-based): 30s, 60s, 120s, ... capped at 15 minutes. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempt - 1), 15 * 60);
}

/**
 * Records a failed attempt. Before the last attempt the job goes back to
 * pending after a backoff; after it, the job is failed for good. If a newer
 * job for the same person is already pending, this one is superseded.
 */
export async function fail(id: number, error: string): Promise<void> {
  await query(
    `update matching_jobs j
        set status = case
              when exists (select 1 from matching_jobs p where p.event_id = j.event_id and p.participant_id = j.participant_id
                             and p.job_type = j.job_type and p.status = 'pending' and p.id <> j.id) then 'done'
              when j.attempts >= $3 then 'failed'
              else 'pending' end,
            available_at = now() + make_interval(secs => least(30 * power(2, greatest(j.attempts - 1, 0)), 900)),
            lease_until = null,
            last_error = left($2, 1000)
      where j.id = $1`,
    [id, error, MAX_ATTEMPTS]
  );
}

export interface FailedJob {
  id: number;
  event_slug: string;
  email: string | null;
  job_type: string;
  attempts: number;
  last_error: string | null;
  started_at: Date | null;
}

/** Jobs that failed for good, newest first (operator inspection). */
export async function listFailed(limit = 50): Promise<FailedJob[]> {
  const { rows } = await query<FailedJob>(
    `select j.id::int as id, e.slug as event_slug, a.email, j.job_type, j.attempts, j.last_error, j.started_at
       from matching_jobs j join events e on e.id = j.event_id left join registered_attendees a on a.id = j.participant_id
      where j.status = 'failed' order by j.started_at desc nulls last limit $1`,
    [limit]
  );
  return rows;
}

/** Queues failed jobs again with fresh attempts (one id, or all). Returns how many. */
export async function retryFailed(id: number | "all"): Promise<number> {
  const { rows } = await query<{ event_id: string; participant_id: string; job_type: "embed" | "match" }>(
    `update matching_jobs set status = 'done', last_error = coalesce(last_error, '') || ' (retried)'
      where status = 'failed' and ($1::bigint is null or id = $1)
      returning event_id, participant_id, job_type`,
    [id === "all" ? null : id]
  );
  for (const row of rows) await enqueue(row.event_id, row.participant_id, row.job_type);
  return rows.length;
}
