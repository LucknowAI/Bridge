-- Which version of the event's profile form a profile was last saved under.
--
-- Organizers can change field labels, visibility and required fields
-- (events.form_config). Existing profiles stay valid and keep matching; this
-- lets the profile page ask someone saved under an older form to fill in
-- fields that have since become required.

alter table event_participants add column if not exists profile_form_version integer not null default 0;
