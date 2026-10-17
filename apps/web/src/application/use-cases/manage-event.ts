import type { EventRepository, RosterAttendeeInput } from "../ports/event-repository";
import { slugify } from "../../domain/shared/value-objects";
import { Intent } from "../../domain/participant/intent";
import { boundedItems, boundedText, LIMITS, ValidationError } from "../../domain/shared/validation";

export async function createEvent(input: { organizationSlug: string; organizerId: string; name: string; slug?: string; description?: string }, events: EventRepository) {
  const organization = await events.findOrganization(input.organizationSlug);
  if (!organization) throw new Error("Organization not found");
  if (!(await events.hasOrganizationAccess(input.organizationSlug, input.organizerId))) throw new Error("You are not an organizer for this organization");
  const name = eventName(input.name)!;
  const slug = slugify(boundedText(input.slug, "slug", "URL slug", LIMITS.eventSlug) || name).slice(0, LIMITS.eventSlug);
  if (!slug) throw new ValidationError("slug", "Use letters or numbers in the event name or URL slug");
  const description = boundedText(input.description, "description", "Description", LIMITS.eventDescription);
  return events.create({ organizationId: organization.id, organizerId: input.organizerId, name, slug, description });
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
  const updated = await events.update({
    ...input,
    name: input.name === undefined ? undefined : eventName(input.name)!,
    description: input.description === undefined ? undefined
      : boundedText(input.description, "description", "Description", LIMITS.eventDescription),
    intents: input.intents === undefined ? undefined : eventIntents(input.intents),
    zones: input.zones === undefined ? undefined
      : boundedItems(input.zones, "zones", "venue zones", { count: LIMITS.zoneCount, length: LIMITS.zoneLength }),
  });
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

function eventName(value: string) {
  return boundedText(value, "name", "Event name", LIMITS.eventName, { required: true, min: LIMITS.eventNameMin });
}

function eventIntents(values: string[]) {
  const intents = boundedItems(values.map((value) => value.toUpperCase()), "intents", "intents",
    { count: Object.keys(Intent).length, length: 40 });
  if (!intents.length || intents.some((intent) => !Object.values(Intent).includes(intent as Intent))) {
    throw new ValidationError("intents", `Use supported intents separated by commas: ${Object.values(Intent).join(", ")}`);
  }
  return intents;
}
