-- ============================================================
-- 0001_init — core schema (ported from the Supabase POC)
--
-- Differences from the Supabase original:
--   * No `auth.users` foreign key. Identity now lives in Keycloak,
--     so `match_sessions.user_subject` stores the Keycloak `sub` claim.
--   * No Row Level Security. All database access is server-side only
--     (the browser no longer holds a database credential), so tenant
--     isolation is enforced in the application layer instead.
-- ============================================================

create table if not exists registered_attendees (
  id                    uuid primary key default gen_random_uuid(),
  name                  text,
  email                 text unique,
  phone                 text unique,          -- E.164 format: +919876543210
  about_me              text,
  designation           text,
  domain                text,
  self_description      text,
  years_of_experience   integer,
  most_impressive_build text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Login verification hits these two columns on every sign-in attempt.
create index if not exists idx_attendees_email on registered_attendees (email);
create index if not exists idx_attendees_phone on registered_attendees (phone);

-- Domain list for the profile dropdown is a DISTINCT scan; keep it cheap.
create index if not exists idx_attendees_domain on registered_attendees (domain);

create table if not exists match_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_subject  text not null,               -- Keycloak `sub` claim
  matched_with  uuid references registered_attendees (id) on delete cascade,
  score         numeric(5, 2),
  match_reason  text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_match_sessions_subject on match_sessions (user_subject);
create index if not exists idx_match_sessions_created on match_sessions (created_at desc);
