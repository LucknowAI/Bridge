"use server";

import { redirect } from "next/navigation";
import { requestIntro } from "../../src/application/use-cases/request-intro";
import { respondToIntro } from "../../src/application/use-cases/respond-to-intro";
import { shareVenueZone } from "../../src/application/use-cases/share-venue-zone";
import { getContainer } from "../../src/composition/container";
import { assertEventAllows } from "../../src/domain/shared/event-lifecycle";
import { answerLocation, requestLocation } from "../../src/application/use-cases/location-requests";
import { getSession } from "../../lib/session";
import { runFormAction, type FormState } from "../../lib/form-state";

export async function requestParticipantIntro(eventSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, () => requestIntroFor(eventSlug, formData));
}

async function requestIntroFor(eventSlug: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in before requesting an introduction");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event) throw new Error("Event not found");
  assertEventAllows(event.status, "requestIntro");
  const recipientId = String(formData.get("recipientId") || "");
  if (!recipientId) throw new Error("Choose a participant");
  await requestIntro({
    eventId: event.id,
    requesterId: session.attendeeId,
    recipientId,
    message: String(formData.get("message") || ""),
    eventName: event.name,
  }, container);
  redirect(`/e/${eventSlug}/connections?requested=1`);
}

export async function respondToParticipantIntro(eventSlug: string, introId: string, accept: boolean, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, () => respondToIntroFor(eventSlug, introId, accept));
}

async function respondToIntroFor(eventSlug: string, introId: string, accept: boolean) {
  const session = await getSession();
  if (!session) throw new Error("Sign in before responding to introductions");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  assertEventAllows(event.status, "respondToIntro");
  await respondToIntro({ eventId: event.id, introId, actorId: session.attendeeId, accept, eventName: event.name }, container);
  redirect(`/e/${eventSlug}/connections`);
}

export async function shareVenueZoneAction(eventSlug: string, introId: string, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, () => shareZoneFor(eventSlug, introId, formData));
}

async function shareZoneFor(eventSlug: string, introId: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in before sharing your location");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  assertEventAllows(event.status, "shareZone");
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
  assertEventAllows(event.status, "viewMatches");
  const [requests, revealed, locationRequests] = await Promise.all([
    container.intros.listForParticipant(event.id, session.attendeeId),
    container.intros.getRevealedContacts(event.id, session.attendeeId),
    container.locations.forParticipant(event.id, session.attendeeId),
  ]);
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
      locationAsked: locationRequests.find((request) => request.introId === intro.id && request.direction === "outgoing") ?? null,
      locationIncoming: locationRequests.find((request) => request.introId === intro.id && request.direction === "incoming" && request.status === "pending") ?? null,
    };
  }));
}

async function participantContext(eventSlug: string, action: "shareZone") {
  const session = await getSession();
  if (!session) throw new Error("Sign in first");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  assertEventAllows(event.status, action);
  return { session, container, event };
}

export async function requestLocationAction(eventSlug: string, introId: string, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, async () => {
    const { session, container, event } = await participantContext(eventSlug, "shareZone");
    await requestLocation({ eventId: event.id, introId, requesterId: session.attendeeId }, container);
    redirect(`/e/${eventSlug}/connections?asked=1#intro-${introId}`);
  });
}

export async function answerLocationAction(eventSlug: string, introId: string, requestId: string, share: boolean, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, async () => {
    const { session, container, event } = await participantContext(eventSlug, "shareZone");
    const zone = share ? String(formData.get("venueZone") ?? "") : null;
    await answerLocation({ eventId: event.id, requestId, recipientId: session.attendeeId, zone, allowedZones: event.zones }, container);
    redirect(`/e/${eventSlug}/connections?${share ? "replied=1" : "declined=1"}#intro-${introId}`);
  });
}
