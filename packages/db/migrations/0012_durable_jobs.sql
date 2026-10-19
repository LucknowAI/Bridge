-- Durable, revision-aware background matching.
--
-- profile_revision goes up on every profile save. Jobs carry the revision
-- they must reflect, and embeddings or match lists are written only while the
-- profile is still at that revision, so a slow job never replaces newer work.
--
-- One job per person and kind may be *pending*; a new edit updates it
-- instead of waiting behind a running one. Running jobs hold a lease; a
-- crashed worker's job is reclaimed when the lease expires. Retryable
-- failures go back to pending with a backoff; after the last attempt a job
-- is 'failed' for good, with its last error kept for inspection.
--
-- trigger_kind tells a job caused by the person's own profile change
-- ('profile') from a refresh because someone else changed ('refresh'); only
-- the first kind asks for others to be refreshed, so refreshes never cascade.

alter table event_participants add column if not exists profile_revision bigint not null default 0;

alter table matching_jobs add column if not exists revision bigint not null default 0;
alter table matching_jobs add column if not exists lease_until timestamptz;
alter table matching_jobs add column if not exists last_error text;
alter table matching_jobs add column if not exists trigger_kind text not null default 'profile';
alter table matching_jobs drop constraint if exists matching_jobs_trigger_kind_check;
alter table matching_jobs add constraint matching_jobs_trigger_kind_check check (trigger_kind in ('profile', 'refresh'));

-- Before this migration 'failed' also meant "will retry"; those rows are pending now.
update matching_jobs set status = 'pending' where status = 'failed' and attempts < 5
  and not exists (select 1 from matching_jobs p where p.event_id = matching_jobs.event_id and p.participant_id = matching_jobs.participant_id
                   and p.job_type = matching_jobs.job_type and p.status = 'pending');

drop index if exists idx_matching_jobs_one_active;
create unique index if not exists idx_matching_jobs_one_pending
  on matching_jobs (event_id, participant_id, job_type) where status = 'pending';
create index if not exists idx_matching_jobs_leases on matching_jobs (lease_until) where status = 'running';
