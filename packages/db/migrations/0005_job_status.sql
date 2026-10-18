-- Show participants and organizers where matching stands.
--
-- `started_at` records when a worker claimed the job, so a job still
-- "running" long after that (a crashed worker) can be shown as stuck instead
-- of pending forever. The index serves "latest job for this participant",
-- which the matches page and the organizer queue summary read.

alter table matching_jobs add column if not exists started_at timestamptz;

create index if not exists idx_matching_jobs_participant_latest
  on matching_jobs(event_id, participant_id, created_at desc);
