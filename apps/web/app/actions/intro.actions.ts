"use server";

import { redirect } from "next/navigation";
import { requestIntro } from "../../src/application/use-cases/request-intro";
import { respondToIntro } from "../../src/application/use-cases/respond-to-intro";
import { shareVenueZone } from "../../src/application/use-cases/share-venue-zone";
import { getContainer } from "../../src/composition/container";
import { getSession } from "../../lib/session";

export async function requestParticipantIntro(eventSlug: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in before requesting an introduction");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event) throw new Error("Event not found");
  const recipientId = String(formData.get("recipientId") || "");
  if (!recipientId) throw new Error("Choose a participant");
  const intro = await requestIntro({
    eventId: event.id,
    requesterId: session.attendeeId,
    recipientId,
    message: String(formData.get("message") || ""),
    eventName: event.name,
  }, container);
  redirect(`/e/${eventSlug}/connections?requested=1`);
}

export async function respondToParticipantIntro(eventSlug: string, introId: string, accept: boolean) {
  const session = await getSession();
  if (!session) throw new Error("Sign in before responding to introductions");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  const intro = await respondToIntro({ eventId: event.id, introId, actorId: session.attendeeId, accept, eventName: event.name }, container);
  redirect(`/e/${eventSlug}/connections`);
}

export async function shareVenueZoneAction(eventSlug: string, introId: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in before sharing your location");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  await shareVenueZone({
    eventId: event.id,
    introId,
    participantId: session.attendeeId,
    zone: String(formData.get("venueZone") || ""),
    allowedZones: event.zones,
  }, container);
  redirect(`/e/${eventSlug}/connections?location=shared`);
}

export async function getParticipantConnections(eventSlug: string) {
  const session = await getSession();
  if (!session) throw new Error("Sign in to view your connections");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  const requests = await container.intros.listForParticipant(event.id, session.attendeeId);
  const revealed = await container.intros.getRevealedContacts(event.id, session.attendeeId);
  const contacts = new Map(revealed.map(({ intro, contact }) => [intro.id, contact]));
  return Promise.all(requests.map(async (intro) => {
    const otherId = intro.requesterId === session.attendeeId ? intro.recipientId : intro.requesterId;
    const other = await container.participants.findProfile(event.id, otherId);
    return {
      id: intro.id,
      status: intro.status,
      message: intro.message,
      createdAt: intro.createdAt.toISOString(),
      incoming: intro.recipientId === session.attendeeId,
      participant: { id: otherId, name: other?.name ?? "Participant", designation: other?.designation, domain: other?.domain },
      contact: contacts.get(intro.id) ?? null,
    };
  }));
}
