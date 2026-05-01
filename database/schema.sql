-- ============================================================
-- Supabase SQL — Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Registered attendees table
--    Matches columns imported from Excel via import-attendees.js
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
  created_at            timestamptz default now()
);

-- Indexes for fast login verification
create index if not exists idx_attendees_email on registered_attendees(email);
create index if not exists idx_attendees_phone on registered_attendees(phone);


-- ============================================================
-- 2. Row Level Security
-- ============================================================

alter table registered_attendees enable row level security;

-- Anon key can SELECT (needed for login verification check)
create policy "allow_anon_read"
  on registered_attendees
  for select
  using (true);

-- Only service-role can insert/update/delete (import script uses service key)


-- ============================================================
-- 3. Match sessions — stores who matched with whom
-- ============================================================

create table if not exists match_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade,
  matched_with  uuid references registered_attendees(id),
  score         numeric(5,2),
  created_at    timestamptz default now()
);

alter table match_sessions enable row level security;

create policy "users_own_matches"
  on match_sessions
  for all
  using (auth.uid() = user_id);
