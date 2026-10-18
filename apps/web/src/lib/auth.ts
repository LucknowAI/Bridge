import { notFound, redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { getContainer } from "../composition/container";
import { eventAllows, type EventAction } from "../domain/shared/event-lifecycle";

/** With `action`, a page the event status does not allow sends the participant to the event landing page, which explains why. */
export async function requireParticipantEvent(eventSlug: string, returnPath?: string, action?: EventAction) {
  const target = returnPath || `/e/${eventSlug}`;
  const session = await getSession();
  if (!session) redirect(`/login?returnTo=${encodeURIComponent(target)}`);
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event) notFound();
  const registered = await container.participants.hasEventAccess(event.id, session.attendeeId);
  if (!registered) notFound();
  await container.events.markClaimed(event.id, session.attendeeId);
  if (action && !eventAllows(event.status, action)) redirect(`/e/${eventSlug}`);
  return { session, event, container };
}

export async function requireOrganizerEvent(orgSlug: string, eventSlug: string, returnPath?: string) {
  const target = returnPath || `/orgs/${orgSlug}/events/${eventSlug}`;
  const session = await getSession();
  if (!session) redirect(`/login?returnTo=${encodeURIComponent(target)}`);
  const container = getContainer();
  const event = await container.events.findBySlug(orgSlug, eventSlug);
  if (!event || !(await container.events.isOrganizer(event.id, session.attendeeId))) notFound();
  return { session, event, container };
}

export async function requireOrganizationMember(orgSlug: string, returnPath?: string) {
  const target = returnPath || `/orgs/${orgSlug}/events/new`;
  const session = await getSession();
  if (!session) redirect(`/login?returnTo=${encodeURIComponent(target)}`);
  const container = getContainer();
  const organization = await container.events.findOrganization(orgSlug);
  if (!organization || !(await container.events.hasOrganizationAccess(orgSlug, session.attendeeId))) notFound();
  return { session, organization, container };
}
