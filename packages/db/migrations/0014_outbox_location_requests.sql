-- Reliable notifications and venue location requests.
--
-- notification_outbox: written in the same transaction as the interaction it
-- announces (an intro request, an acceptance, a location request or reply),
-- then delivered by the worker with retries. dedupe_key makes each
-- notification unique, so retries and replays never send duplicates.
-- Sent rows are swept after 30 days.
--
-- location_requests: "where are you?" between two accepted connections. The
-- recipient may reply with a configured venue zone or decline; the reply is
-- visible only to the person who asked, for 15 minutes. Pending requests
-- expire after 30 minutes. Rows are swept after a day.

create table if not exists notification_outbox (
  id           bigserial primary key,
  event_id     uuid references events(id) on delete cascade,
  recipient_id uuid not null,
  kind         text not null,
  subject_id   uuid not null,
  dedupe_key   text not null unique,
  status       text not null default 'pending' check (status in ('pending', 'running', 'sent', 'failed')),
  attempts     integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until  timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists idx_notification_outbox_due on notification_outbox (available_at) where status in ('pending', 'running');

create table if not exists location_requests (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  intro_id        uuid not null references intro_requests(id) on delete cascade,
  requester_id    uuid not null,
  recipient_id    uuid not null,
  status          text not null default 'pending' check (status in ('pending', 'answered', 'declined')),
  zone            text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  answered_at     timestamptz,
  zone_expires_at timestamptz,
  check (requester_id <> recipient_id)
);
-- One open request per direction of a connection.
create unique index if not exists idx_location_requests_one_pending
  on location_requests (intro_id, requester_id) where status = 'pending';
create index if not exists idx_location_requests_people on location_requests (event_id, recipient_id, created_at desc);
