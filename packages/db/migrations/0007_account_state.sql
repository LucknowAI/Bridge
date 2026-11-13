-- Account-wide access, independent of any one event.
--
-- disabled_at          the account may not sign in or use any session
-- sessions_revoked_at  sessions issued before this moment are no longer valid
--                      (sign out everywhere), without disabling the account
--
-- Session cookies are self-contained, so every request checks these columns.

alter table registered_attendees add column if not exists disabled_at timestamptz;
alter table registered_attendees add column if not exists sessions_revoked_at timestamptz;
