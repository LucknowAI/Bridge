import type { EventRepository, RosterAttendeeInput } from "../ports/event-repository";
import { slugify } from "../../domain/shared/value-objects";

export async function createEvent(input: { organizationSlug: string; organizerId: string; name: string; slug?: string; description?: string }, events: EventRepository) {
  const organization = await events.findOrganization(input.organizationSlug);
  if (!organization) throw new Error("Organization not found");
  if (!(await events.hasOrganizationAccess(input.organizationSlug, input.organizerId))) throw new Error("You are not an organizer for this organization");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Event name must be between 2 and 120 characters");
  const slug = slugify(input.slug || name);
  if (!slug) throw new Error("Enter a valid event name or slug");
  return events.create({ organizationId: organization.id, organizerId: input.organizerId, name, slug, description: input.description?.trim() || null });
}

export async function updateEvent(input: {
  eventId: string;
  organizerId: string;
  name?: string;
  description?: string | null;
  status?: "draft" | "open" | "closed";
  intents?: string[];
  zones?: string[];
}, events: EventRepository) {
  if (!(await events.isOrganizer(input.eventId, input.organizerId))) throw new Error("You are not an organizer for this event");
  const updated = await events.update(input);
  if (!updated) throw new Error("Event not found");
  return updated;
}

export async function importEventRoster(input: { eventId: string; organizerId: string; records: RosterAttendeeInput[] }, events: EventRepository) {
  if (!(await events.isOrganizer(input.eventId, input.organizerId))) throw new Error("You are not an organizer for this event");
  if (!input.records.length) return { upserted: 0, attached: 0 };
  return events.importRoster(input.eventId, input.records);
}

export async function queueEventMatches(input: { eventId: string; organizerId: string }, events: EventRepository, enqueue: (eventId: string, participantId: string) => Promise<void>) {
  if (!(await events.isOrganizer(input.eventId, input.organizerId))) throw new Error("You are not an organizer for this event");
  const participants = await events.participantIds(input.eventId);
  for (const participantId of participants) await enqueue(input.eventId, participantId);
  return participants.length;
}
