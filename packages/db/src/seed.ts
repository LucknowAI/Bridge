/**
 * Development seed data.
 *
 * Gives the local stack a usable attendee roster without needing the real
 * attendees.xlsx (which holds PII and is git-ignored). Safe to re-run — every
 * row upserts on e-mail.
 *
 * Run with:  npm run db:seed
 */
import "dotenv/config";
import { closePool } from "./client";
import { upsertMany } from "./repositories/attendees";
import * as events from "./repositories/events";
import { query } from "./client";
import { isMainModule } from "./is-main";

const SEED_ATTENDEES = [
  {
    name: "Mr. Bridge Organizer",
    email: "organizer@example.com",
    phone: "+919876543209",
    designation: "Event Organizer",
    domain: "Community Building",
    about_me: "Local development organizer account.",
    self_description: "Organizing the community event",
    years_of_experience: 5,
    most_impressive_build: "A welcoming professional community.",
  },
  {
    name: "Aarav Sharma",
    email: "aarav@example.com",
    phone: "+919876543210",
    designation: "Senior ML Engineer",
    domain: "Machine Learning",
    about_me: "Building retrieval systems for Indian language corpora.",
    self_description: "Working full-time as an ML engineer",
    years_of_experience: 7,
    most_impressive_build: "A Hindi-English RAG search engine used by 40k people.",
  },
  {
    name: "Diya Verma",
    email: "diya@example.com",
    phone: "+919876543211",
    designation: "Frontend Lead",
    domain: "Frontend Development",
    about_me: "Design systems, accessibility, and very fast React.",
    self_description: "Leading a frontend team",
    years_of_experience: 6,
    most_impressive_build: "An offline-first PWA for rural health workers.",
  },
  {
    name: "Kabir Singh",
    email: "kabir@example.com",
    phone: "+919876543212",
    designation: "Platform Engineer",
    domain: "Cloud & DevOps",
    about_me: "Kubernetes, Terraform, and keeping the bill down.",
    self_description: "Running platform for a Series B startup",
    years_of_experience: 9,
    most_impressive_build: "Cut inference cost 70% by moving to spot GPU nodes.",
  },
  {
    name: "Ananya Iyer",
    email: "ananya@example.com",
    phone: "+919876543213",
    designation: "Security Researcher",
    domain: "Cybersecurity",
    about_me: "Adversarial ML and red-teaming LLM deployments.",
    self_description: "Independent security researcher",
    years_of_experience: 5,
    most_impressive_build: "A prompt-injection scanner for agent frameworks.",
  },
  {
    name: "Rohan Gupta",
    email: "rohan@example.com",
    phone: "+919876543214",
    designation: "Founding Engineer",
    domain: "Generative AI & LLM Engineering",
    about_me: "Shipping agents that actually survive production traffic.",
    self_description: "Building my own startup",
    years_of_experience: 4,
    most_impressive_build: "An AI agent that files and tracks municipal complaints.",
  },
  {
    name: "Meera Nair",
    email: "meera@example.com",
    phone: "+919876543215",
    designation: "Data Engineer",
    domain: "Data Engineering & ETL",
    about_me: "Streaming pipelines, dbt, and stubbornly clean schemas.",
    self_description: "Working full-time as a data engineer",
    years_of_experience: 8,
    most_impressive_build: "A real-time feature store powering fraud detection.",
  },
];

export async function seed(): Promise<number> {
  const written = await upsertMany(SEED_ATTENDEES);
  const { rows: organizationRows } = await query<{ id: string }>(
    `insert into organizations (name, slug) values ('AI Community Lucknow', 'ai-community-lucknow')
     on conflict (slug) do update set name = excluded.name returning id`
  );
  const organizationId = organizationRows[0]?.id;
  if (!organizationId) throw new Error("Could not seed the demo organization");
  const { rows: eventRows } = await query<{ id: string }>(
    `insert into events (organization_id, name, slug, description, status, zones)
     values ($1, 'AI Community Lucknow Meetup', 'demo', 'A local demo event for the Mr. Bridge networking flow.', 'open', '["Main hall","Workshop room","Registration desk"]'::jsonb)
     on conflict (organization_id, slug) do update set status = 'open' returning id`,
    [organizationId]
  );
  const eventId = eventRows[0]?.id;
  if (!eventId) throw new Error("Could not seed the demo event");
  const emails = SEED_ATTENDEES.map((attendee) => attendee.email);
  const { rows: rosterRows } = await query<{ id: string; email: string }>(
    `select id, email from registered_attendees where email = any($1::text[])`, [emails]
  );
  await events.attachRoster(eventId, rosterRows.map((row) => row.id));
  const organizer = rosterRows.find((row) => row.email === "organizer@example.com");
  if (organizer) {
    await query(
      `insert into organization_members (organization_id, attendee_id, role) values ($1, $2, 'owner')
       on conflict (organization_id, attendee_id) do update set role = 'owner'`,
      [organizationId, organizer.id]
    );
    await query(
      `insert into event_organizers (event_id, attendee_id, role) values ($1, $2, 'owner')
       on conflict (event_id, attendee_id) do update set role = 'owner'`,
      [eventId, organizer.id]
    );
  }
  console.log(`[seed] upserted ${written} attendee(s)`);
  return written;
}

if (isMainModule(import.meta.url)) {
  seed()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("[seed] failed:", err.message);
      await closePool().catch(() => {});
      process.exit(1);
    });
}
