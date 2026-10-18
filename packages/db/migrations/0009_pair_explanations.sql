-- Cached one-sentence reasons for a viewer -> candidate pair.
--
-- The key covers the event, both people (in that direction), both profile
-- revisions, the model, prompt and scoring versions, and the query context,
-- so a changed profile or query never reuses stale reasoning. Only reasons
-- are cached here, never a shortlist order.

create table if not exists pair_explanations (
  cache_key    text primary key,
  event_id     uuid not null references events(id) on delete cascade,
  viewer_id    uuid not null,
  candidate_id uuid not null,
  reason       text not null,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_pair_explanations_expires on pair_explanations (expires_at);
create index if not exists idx_pair_explanations_people on pair_explanations (event_id, candidate_id);
