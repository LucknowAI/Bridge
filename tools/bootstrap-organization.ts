import "dotenv/config";
import { attendees, events, query, closePool } from "@match-maker/db";

async function main() {
  const [organizationName, organizationSlugRaw, organizerEmailRaw, eventName, eventSlugRaw] = process.argv.slice(2);
  if (!organizationName || !organizationSlugRaw || !organizerEmailRaw || !eventName || !eventSlugRaw) {
    throw new Error("Usage: npm run org:init -- <organization-name> <organization-slug> <organizer-email> <event-name> <event-slug>");
  }
  const organizationSlug = slugify(organizationSlugRaw);
  const eventSlug = slugify(eventSlugRaw);
  const organizerEmail = organizerEmailRaw.trim().toLowerCase();
  const organizer = await attendees.findByEmail(organizerEmail);
  if (!organizer) throw new Error(`Organizer ${organizerEmail} is not imported. Import the attendee sheet with --no-event first.`);

  const { rows: organizations } = await query<{ id: string }>(
    `insert into organizations (name, slug) values ($1, $2)
     on conflict (slug) do update set name = excluded.name returning id`,
    [organizationName.trim(), organizationSlug]
  );
  const organizationId = organizations[0]?.id;
  if (!organizationId) throw new Error("Could not create the organization");

  await query(
    `insert into organization_members (organization_id, attendee_id, role)
     values ($1, $2, 'owner') on conflict (organization_id, attendee_id) do update set role = 'owner'`,
    [organizationId, organizer.id]
  );

  let event = await events.findBySlug(organizationSlug, eventSlug);
  if (!event) {
    event = await events.create({
      organizationId,
      organizerId: organizer.id,
      name: eventName.trim(),
      slug: eventSlug,
      description: "Created by the organization bootstrap command.",
    });
  }
  await query(
    `insert into event_organizers (event_id, attendee_id, role)
     values ($1, $2, 'owner') on conflict (event_id, attendee_id) do update set role = 'owner'`,
    [event.id, organizer.id]
  );
  await events.attachRoster(event.id, [organizer.id]);
  console.info(`Organization ready: /orgs/${organizationSlug}/events/${eventSlug}`);
}

function slugify(value: string): string {
  const result = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!result) throw new Error("Organization and event slugs must contain letters or numbers");
  return result;
}

main().then(() => closePool()).catch(async (error) => {
  console.error("[org:init] failed:", error instanceof Error ? error.message : error);
  await closePool().catch(() => {});
  process.exit(1);
});
