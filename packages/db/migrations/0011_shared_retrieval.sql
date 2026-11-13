-- Shared search retrieval across web replicas.
--
-- cache_locks: short-lived ownership of one expensive computation (a query
-- embedding or a retrieval), so concurrent identical searches on different
-- replicas compute it once. An expired lock can be taken over; only its
-- owner can release it.
--
-- events.corpus_revision: bumped whenever an event's participants change
-- (added, removed, profile/visibility/access/embedding updated). It is part
-- of every retrieval cache key, so a change sends new searches to a fresh
-- entry instead of serving candidates retrieved from the old corpus.

create table if not exists cache_locks (
  lock_key   text primary key,
  owner      text not null,
  expires_at timestamptz not null
);

alter table events add column if not exists corpus_revision bigint not null default 0;

create or replace function bump_corpus_revision() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    update events set corpus_revision = corpus_revision + 1 where id in (select distinct event_id from old_rows);
  else
    update events set corpus_revision = corpus_revision + 1 where id in (select distinct event_id from new_rows);
  end if;
  return null;
end $$;

-- One bump per statement and event, so a 10,000-row import is a single update.
drop trigger if exists event_participants_corpus_insert on event_participants;
create trigger event_participants_corpus_insert after insert on event_participants
  referencing new table as new_rows for each statement execute function bump_corpus_revision();

drop trigger if exists event_participants_corpus_update on event_participants;
create trigger event_participants_corpus_update after update on event_participants
  referencing new table as new_rows for each statement execute function bump_corpus_revision();

drop trigger if exists event_participants_corpus_delete on event_participants;
create trigger event_participants_corpus_delete after delete on event_participants
  referencing old table as old_rows for each statement execute function bump_corpus_revision();
