-- Invited account lifecycle per event.
--
-- The roster row is the invitation. These columns record whether the
-- invitation e-mail went out (and why it failed), when the attendee first
-- signed in to the event (claimed), and whether the organizer removed their
-- access. A revoked row keeps its history but grants nothing: no sign-in to
-- the event, no matching, no appearance in anyone's results.

alter table event_participants add column if not exists invited_at timestamptz;
alter table event_participants add column if not exists invite_count integer not null default 0;
alter table event_participants add column if not exists invite_error text;
alter table event_participants add column if not exists claimed_at timestamptz;
alter table event_participants add column if not exists revoked_at timestamptz;

-- Anyone who already saved a profile has evidently claimed their invitation.
update event_participants
   set claimed_at = profile_updated_at
 where claimed_at is null and profile_updated_at is not null;
