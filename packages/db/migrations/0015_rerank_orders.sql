-- The model's order for one exact shortlist.
--
-- pair_explanations holds reasons per pair, never an order. When every pair of
-- a shortlist is cached the model is not asked again, and without its earlier
-- order the list fell back to score order, so a refresh that changed nothing
-- reshuffled a stored list. The key is built from every pair key in the set,
-- so an order is reused only for the same viewer, the same candidates at the
-- same revisions, and the same model, prompt, scoring and context.

create table if not exists rerank_orders (
  cache_key     text primary key,
  event_id      uuid not null references events(id) on delete cascade,
  viewer_id     uuid not null,
  candidate_ids uuid[] not null,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_rerank_orders_expires on rerank_orders (expires_at);
create index if not exists idx_rerank_orders_candidates on rerank_orders using gin (candidate_ids);
