"use server";

import { redirect } from "next/navigation";
import { createEvent, importEventRoster, queueEventMatches, updateEvent } from "../../src/application/use-cases/manage-event";
import { getContainer } from "../../src/composition/container";
import { assertEventAllows } from "../../src/domain/shared/event-lifecycle";
import { LIMITS, ValidationError } from "../../src/domain/shared/validation";
import { runFormAction, type FormState } from "../../lib/form-state";
import { parseRosterWorkbook } from "../../src/lib/excel-importer";
import { getSession } from "../../lib/session";
import { sendInvitations, setAttendeeAccess } from "../../src/application/use-cases/manage-invitations";

export async function createEventAction(organizationSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, async () => {
    const session = await getSession();
    if (!session) throw new Error("Sign in as an organizer first");
    const event = await createEvent({
      organizationSlug,
      organizerId: session.attendeeId,
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      description: String(formData.get("description") ?? ""),
    }, getContainer().events).catch((error) => {
      if (error?.code === "23505") throw new ValidationError("slug", "That URL slug is already used by another event");
      throw error;
    });
    redirect(`/orgs/${organizationSlug}/events/${event.slug}`);
  });
}

export async function importEventRosterAction(organizationSlug: string, eventSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, () => importRoster(organizationSlug, eventSlug, formData));
}

async function importRoster(organizationSlug: string, eventSlug: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in as an organizer first");
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) throw new ValidationError("file", "Choose an Excel roster file");
  if (file.size > LIMITS.rosterBytes) throw new ValidationError("file", "Roster files are limited to 10 MB");
  const container = getContainer();
  const event = await container.events.findBySlug(organizationSlug, eventSlug);
  if (!event) throw new Error("Event not found");
  const { records, skipped } = parseRosterWorkbook(await file.arrayBuffer());
  const result = await importEventRoster({ eventId: event.id, organizerId: session.attendeeId, records }, container.events);
  const report = new URLSearchParams({
    imported: String(result.attached), skipped: String(skipped), already: String(result.alreadyOnRoster),
    kept: String(result.keptExisting), phones: String(result.phoneConflicts),
  });
  redirect(`/orgs/${organizationSlug}/events/${eventSlug}/roster?${report}`);
}

export async function updateEventAction(organizationSlug: string, eventSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, () => saveEvent(organizationSlug, eventSlug, formData));
}

async function saveEvent(organizationSlug: string, eventSlug: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in as an organizer first");
  const container = getContainer();
  const event = await container.events.findBySlug(organizationSlug, eventSlug);
  if (!event) throw new Error("Event not found");
  const status = String(formData.get("status") || event.status);
  if (!["draft", "open", "closed"].includes(status)) throw new ValidationError("status", "Choose a valid event status");
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

export async function computeEventMatchesAction(organizationSlug: string, eventSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, () => queueMatches(organizationSlug, eventSlug));
}

async function queueMatches(organizationSlug: string, eventSlug: string) {
  const session = await getSession();
  if (!session) throw new Error("Sign in as an organizer first");
  const container = getContainer();
  const event = await container.events.findBySlug(organizationSlug, eventSlug);
  if (!event) throw new Error("Event not found");
  assertEventAllows(event.status, "computeMatches");
  if (event.status === "draft") await updateEvent({ eventId: event.id, organizerId: session.attendeeId, status: "open" }, container.events);
  const queued = await queueEventMatches({ eventId: event.id, organizerId: session.attendeeId }, container.events, container.enqueueEmbedding);
  redirect(`/orgs/${organizationSlug}/events/${eventSlug}/matching?queued=${queued}`);
}

/** Invites everyone never invited, or (with attendeeId) resends to one person. */
export async function sendInvitationsAction(organizationSlug: string, eventSlug: string, attendeeId: string | null, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, async () => {
    const session = await getSession();
    if (!session) throw new Error("Sign in as an organizer first");
    const container = getContainer();
    const event = await container.events.findBySlug(organizationSlug, eventSlug);
    if (!event) throw new Error("Event not found");
    const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
    const result = await sendInvitations({
      eventId: event.id,
      organizerId: session.attendeeId,
      eventName: event.name,
      organizationName: event.organization_name,
      eventUrl: `${base}/e/${event.slug}`,
      attendeeId: attendeeId ?? undefined,
    }, container);
    redirect(`/orgs/${organizationSlug}/events/${eventSlug}/roster?invited=${result.sent}&failed=${result.failed}`);
  });
}

export async function setAttendeeAccessAction(organizationSlug: string, eventSlug: string, attendeeId: string, revoked: boolean, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, async () => {
    const session = await getSession();
    if (!session) throw new Error("Sign in as an organizer first");
    const container = getContainer();
    const event = await container.events.findBySlug(organizationSlug, eventSlug);
    if (!event) throw new Error("Event not found");
    await setAttendeeAccess({ eventId: event.id, organizerId: session.attendeeId, attendeeId, revoked }, container);
    redirect(`/orgs/${organizationSlug}/events/${eventSlug}/roster?access=${revoked ? "removed" : "restored"}`);
  });
}
