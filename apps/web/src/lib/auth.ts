import { notFound, redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { getContainer } from "../composition/container";
import { eventAllows, type EventAction } from "../domain/shared/event-lifecycle";
import { organizerCan, type OrganizerAction } from "../domain/shared/organizer-permissions";

/** With `action`, a page the event status does not allow sends the participant to the event landing page, which explains why. */
export async function requireParticipantEvent(eventSlug: string, returnPath?: string, action?: EventAction) {
  const target = returnPath || `/e/${eventSlug}`;
  const session = await getSession();
  if (!session) redirect(`/login?returnTo=${encodeURIComponent(target)}`);
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event) notFound();
  const registered = await container.participants.hasEventAccess(event.id, session.attendeeId);
  // The landing page explains why: removed by the organizer, or a different account.
  if (!registered) redirect(`/e/${eventSlug}`);
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
  if (!event) notFound();
  const roles = await container.events.organizerRoles(event.id, session.attendeeId);
  if (!organizerCan(roles, "view")) notFound();
  const can = (action: OrganizerAction) => organizerCan(roles, action);
  return { session, event, container, can };
}

/**
 * Organization pages. Members always get in; with `allowEventOrganizers`, so do
 * people who organize one of its events without being members (they see only
 * their events). `isMember` says whether they may create events.
 */
export async function requireOrganizationMember(orgSlug: string, returnPath?: string, options: { allowEventOrganizers?: boolean } = {}) {
  const target = returnPath || `/orgs/${orgSlug}/events/new`;
  const session = await getSession();
  if (!session) redirect(`/login?returnTo=${encodeURIComponent(target)}`);
  const container = getContainer();
  const organization = await container.events.findOrganization(orgSlug);
  if (!organization) notFound();
  const isMember = await container.events.hasOrganizationAccess(orgSlug, session.attendeeId);
  if (!isMember && !(options.allowEventOrganizers && (await container.events.listForOrganization(orgSlug, session.attendeeId)).length)) notFound();
  return { session, organization, container, isMember };
}
