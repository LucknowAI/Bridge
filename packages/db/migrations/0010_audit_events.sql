-- Security audit records: who did what to whom, for sensitive actions
-- (roster imports, invitations, access changes, settings, contact reveals,
-- account administration). Details hold counts and field names, never
-- contact data. Kept for a year by the housekeeping sweep.

create table if not exists audit_events (
  id          bigserial primary key,
  event_id    uuid references events(id) on delete set null,
  actor_id    uuid,
  action      text not null,
  subject_id  uuid,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_events_event on audit_events (event_id, created_at desc);
create index if not exists idx_audit_events_created on audit_events (created_at);
