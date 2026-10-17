-- Event tenancy, participant profiles, semantic matching, and introductions.
-- PostgreSQL 16 with pgvector is used by local Docker and RDS.
create extension if not exists vector;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  attendee_id uuid not null references registered_attendees(id) on delete cascade,
  role text not null default 'organizer' check (role in ('owner', 'admin', 'organizer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, attendee_id)
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  intents jsonb not null default '["NETWORKING","SEEKING_MENTOR","MENTORING","LOOKING_FOR_COFOUNDER","LOOKING_FOR_COLLABORATORS","LOOKING_FOR_WORK","HIRING","RAISING_FUNDING","INVESTING"]'::jsonb,
  zones jsonb not null default '[]'::jsonb,
  form_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists event_organizers (
  event_id uuid not null references events(id) on delete cascade,
  attendee_id uuid not null references registered_attendees(id) on delete cascade,
  role text not null default 'organizer' check (role in ('owner', 'admin', 'organizer')),
  created_at timestamptz not null default now(),
  primary key (event_id, attendee_id)
);
create unique index if not exists idx_events_public_slug on events(slug);

-- Membership is the imported roster gate. Contact information remains in
-- registered_attendees and is never included in public candidate queries.
create table if not exists event_participants (
  event_id uuid not null references events(id) on delete cascade,
  attendee_id uuid not null references registered_attendees(id) on delete cascade,
  intent text not null default 'NETWORKING',
  interests text[] not null default '{}',
  venue_zone text,
  visible boolean not null default true,
  about_me text,
  designation text,
  domain text,
  self_description text,
  years_of_experience integer check (years_of_experience is null or years_of_experience between 0 and 80),
  most_impressive_build text,
  embedding vector(768),
  profile_updated_at timestamptz,
  location_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, attendee_id)
);

create index if not exists idx_event_participants_event_visible
  on event_participants (event_id, visible);
create index if not exists idx_event_participants_intent
  on event_participants (event_id, intent);
create index if not exists idx_event_participants_embedding
  on event_participants using hnsw (embedding vector_cosine_ops);

create table if not exists event_matches (
  event_id uuid not null,
  participant_id uuid not null,
  candidate_id uuid not null,
  score numeric(5, 2) not null,
  score_breakdown jsonb not null default '{}'::jsonb,
  match_reason text,
  mutual_interest boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (event_id, participant_id, candidate_id),
  foreign key (event_id, participant_id) references event_participants(event_id, attendee_id) on delete cascade,
  foreign key (event_id, candidate_id) references event_participants(event_id, attendee_id) on delete cascade,
  check (participant_id <> candidate_id)
);
create index if not exists idx_event_matches_participant on event_matches(event_id, participant_id, score desc);

create table if not exists intro_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  requester_id uuid not null,
  recipient_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  message text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  foreign key (event_id, requester_id) references event_participants(event_id, attendee_id) on delete cascade,
  foreign key (event_id, recipient_id) references event_participants(event_id, attendee_id) on delete cascade,
  check (requester_id <> recipient_id),
  unique (event_id, requester_id, recipient_id)
);
create index if not exists idx_intro_requests_recipient on intro_requests(event_id, recipient_id, status, created_at desc);
create index if not exists idx_intro_requests_requester on intro_requests(event_id, requester_id, status, created_at desc);

-- Shared retrieval cache plus simple database-backed work/rate-limit records
-- keep the compose stack self-contained. Production can bind Redis through the
-- same ports without changing the application or domain layers.
create table if not exists retrieval_cache (
  cache_key text primary key,
  candidate_ids jsonb not null,
  expires_at timestamptz not null
);
create index if not exists idx_retrieval_cache_expiry on retrieval_cache(expires_at);

create table if not exists matching_jobs (
  id bigserial primary key,
  event_id uuid not null references events(id) on delete cascade,
  participant_id uuid not null references registered_attendees(id) on delete cascade,
  job_type text not null default 'match' check (job_type in ('embed', 'match')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_matching_jobs_pending on matching_jobs(status, available_at) where status in ('pending', 'failed');
create unique index if not exists idx_matching_jobs_one_active on matching_jobs(event_id, participant_id, job_type) where status in ('pending', 'running');

create table if not exists rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  count integer not null
);
