-- ============================================================
-- 0002_login_challenges — passwordless e-mail login (Resend)
--
-- One row per login attempt. The same row backs BOTH delivery
-- methods in the e-mail: the 6-digit code the user can type, and
-- the one-click magic link. Whichever is used first consumes the
-- row, so a code and its link can never both be redeemed.
--
-- Only hashes are stored — a database leak must not yield a
-- usable login credential.
-- ============================================================

create table if not exists login_challenges (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  attendee_id  uuid references registered_attendees (id) on delete cascade,
  code_hash    text not null,               -- sha256(6-digit code + pepper)
  token_hash   text not null unique,        -- sha256(magic-link token)
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  attempts     integer not null default 0,  -- brute-force counter on the code
  ip_address   text,
  created_at   timestamptz not null default now()
);

-- Verification looks the row up by token (magic link) or by e-mail (code entry).
create index if not exists idx_login_challenges_token on login_challenges (token_hash);
create index if not exists idx_login_challenges_email on login_challenges (email, created_at desc);

-- Supports the sweep of expired rows and the per-e-mail rate limit window.
create index if not exists idx_login_challenges_expires on login_challenges (expires_at);
