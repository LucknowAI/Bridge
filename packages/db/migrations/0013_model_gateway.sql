-- Model gateway accounting and versioned embeddings.
--
-- model_usage: one row per provider call (provider and model, operation,
-- outcome, latency, approximate tokens) for cost and reliability reports.
-- Kept 90 days by the housekeeping sweep.
--
-- event_participants.embedding_model: which provider/model produced the
-- stored vector. Vectors from different models live in different spaces and
-- are never compared; a profile embedded by another model is embedded again.

create table if not exists model_usage (
  id          bigserial primary key,
  provider    text not null,
  operation   text not null,
  outcome     text not null check (outcome in ('ok', 'error', 'timeout', 'rejected')),
  latency_ms  integer not null,
  input_chars integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_model_usage_created on model_usage (created_at);

alter table event_participants add column if not exists embedding_model text;
