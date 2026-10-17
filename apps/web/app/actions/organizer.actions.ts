"use server";

import { redirect } from "next/navigation";
import { createEvent, importEventRoster, queueEventMatches, updateEvent } from "../../src/application/use-cases/manage-event";
import { getContainer } from "../../src/composition/container";
import { LIMITS } from "../../src/domain/shared/validation";
import { parseRosterWorkbook } from "../../src/lib/excel-importer";
import { getSession } from "../../lib/session";

export async function createEventAction(organizationSlug: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in as an organizer first");
  const container = getContainer();
  const event = await createEvent({
    organizationSlug,
    organizerId: session.attendeeId,
    name: String(formData.get("name") || ""),
    slug: String(formData.get("slug") || ""),
    description: String(formData.get("description") || ""),
  }, container.events);
  redirect(`/orgs/${organizationSlug}/events/${event.slug}`);
}

export async function importEventRosterAction(organizationSlug: string, eventSlug: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in as an organizer first");
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Choose an Excel roster file");
  if (file.size > LIMITS.rosterBytes) throw new Error("Roster files are limited to 10 MB");
  const container = getContainer();
  const event = await container.events.findBySlug(organizationSlug, eventSlug);
  if (!event) throw new Error("Event not found");
  const records = parseRosterWorkbook(await file.arrayBuffer());
  const result = await importEventRoster({ eventId: event.id, organizerId: session.attendeeId, records }, container.events);
  redirect(`/orgs/${organizationSlug}/events/${eventSlug}/roster?imported=${result.attached}`);
}

export async function updateEventAction(organizationSlug: string, eventSlug: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in as an organizer first");
  const container = getContainer();
  const event = await container.events.findBySlug(organizationSlug, eventSlug);
  if (!event) throw new Error("Event not found");
  const status = String(formData.get("status") || event.status);
  if (!["draft", "open", "closed"].includes(status)) throw new Error("Choose a valid event status");
  const intents = String(formData.get("intents") ?? "").split(",");
  const zones = String(formData.get("zones") ?? "").split(",");
  await updateEvent({
    eventId: event.id,
    organizerId: session.attendeeId,
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") || ""),
    status: status as "draft" | "open" | "closed",
    intents,
    zones,
  }, container.events);
  redirect(`/orgs/${organizationSlug}/events/${eventSlug}?saved=1`);
}

export async function computeEventMatchesAction(organizationSlug: string, eventSlug: string) {
  const session = await getSession();
  if (!session) throw new Error("Sign in as an organizer first");
  const container = getContainer();
  const event = await container.events.findBySlug(organizationSlug, eventSlug);
  if (!event) throw new Error("Event not found");
  if (event.status !== "open") await updateEvent({ eventId: event.id, organizerId: session.attendeeId, status: "open" }, container.events);
  const queued = await queueEventMatches({ eventId: event.id, organizerId: session.attendeeId }, container.events, container.enqueueEmbedding);
  redirect(`/orgs/${organizationSlug}/events/${eventSlug}/matching?queued=${queued}`);
}
