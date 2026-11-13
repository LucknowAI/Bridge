-- Persist the final order of saved matches.
--
-- The LLM rerank can order the shortlist differently from the numeric score,
-- but rows were stored without a position and read back by score, so a page
-- reload silently undid the rerank. `rank` is the 1-based position shown to the
-- participant; `computation_version` records which pipeline and reranker
-- produced the list, so stale results can be identified and recomputed.

alter table event_matches add column if not exists rank integer;
alter table event_matches add column if not exists computation_version text not null default 'legacy';

-- Existing rows keep the order they were already displayed in.
update event_matches m
   set rank = ordered.position
  from (
    select event_id, participant_id, candidate_id,
           row_number() over (
             partition by event_id, participant_id
             order by score desc, created_at desc, candidate_id
           ) as position
      from event_matches
  ) ordered
 where m.event_id = ordered.event_id
   and m.participant_id = ordered.participant_id
   and m.candidate_id = ordered.candidate_id
   and m.rank is null;

alter table event_matches alter column rank set not null;
alter table event_matches add constraint event_matches_rank_positive check (rank > 0);
-- New rows must say which computation produced them.
alter table event_matches alter column computation_version drop default;

create unique index if not exists idx_event_matches_rank on event_matches(event_id, participant_id, rank);
drop index if exists idx_event_matches_participant;
