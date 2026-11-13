"use server";

import { redirect } from "next/navigation";
import { searchParticipants } from "../../src/application/use-cases/search-participants";
import { getMyMatches } from "../../src/application/use-cases/get-my-matches";
import { getContainer } from "../../src/composition/container";
import { getSession } from "../../lib/session";

export async function searchEventParticipants(eventSlug: string, searchText: string) {
  const session = await getSession();
  if (!session) throw new Error("Sign in to search this event");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || event.status !== "open") throw new Error("This event is not open for matching");
  if (!(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  const results = await searchParticipants({ eventId: event.id, participantId: session.attendeeId, query: searchText }, container);
  return results.map((match) => ({
    id: match.participant.attendeeId,
    name: match.participant.name,
    designation: match.participant.designation,
    domain: match.participant.domain,
    aboutMe: match.participant.aboutMe,
    yearsOfExperience: match.participant.yearsOfExperience,
    mostImpressiveBuild: match.participant.mostImpressiveBuild,
    score: match.score,
    reason: match.reason,
    mutualInterest: match.mutualInterest,
  }));
}

export async function getParticipantMatches(eventSlug: string) {
  const session = await getSession();
  if (!session) throw new Error("Sign in to view your matches");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  const results = await getMyMatches({ eventId: event.id, participantId: session.attendeeId }, container.matches);
  return results.map((match) => ({
    id: match.participant.attendeeId,
    name: match.participant.name,
    designation: match.participant.designation,
    domain: match.participant.domain,
    aboutMe: match.participant.aboutMe,
    yearsOfExperience: match.participant.yearsOfExperience,
    mostImpressiveBuild: match.participant.mostImpressiveBuild,
    score: match.score,
    scoreBreakdown: match.scoreBreakdown,
    reason: match.reason,
    mutualInterest: match.mutualInterest,
  }));
}

export async function refreshParticipantMatches(eventSlug: string) {
  const session = await getSession();
  if (!session) throw new Error("Sign in to refresh your matches");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  await container.enqueueEmbedding(event.id, session.attendeeId);
  redirect(`/e/${eventSlug}/matches?queued=1`);
}
