"use server";

import { redirect } from "next/navigation";
import { searchParticipants } from "../../src/application/use-cases/search-participants";
import { getMyMatches } from "../../src/application/use-cases/get-my-matches";
import { getContainer } from "../../src/composition/container";
import { assertEventAllows } from "../../src/domain/shared/event-lifecycle";
import { getSession } from "../../lib/session";
import { runFormAction, userMessage, type FormState } from "../../lib/form-state";

export async function searchEventParticipants(eventSlug: string, searchText: string) {
  try {
    return { results: await searchEvent(eventSlug, searchText), error: null };
  } catch (error) {
    return { results: [], error: userMessage(error, "Search failed. Please try again.") };
  }
}

async function searchEvent(eventSlug: string, searchText: string) {
  const session = await getSession();
  if (!session) throw new Error("Sign in to search this event");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  assertEventAllows(event.status, "search");
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
  assertEventAllows(event.status, "viewMatches");
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

export async function refreshParticipantMatches(eventSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, () => queueRefresh(eventSlug));
}

async function queueRefresh(eventSlug: string) {
  const session = await getSession();
  if (!session) throw new Error("Sign in to refresh your matches");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) throw new Error("You are not registered for this event");
  assertEventAllows(event.status, "refreshMatches");
  await container.enqueueEmbedding(event.id, session.attendeeId);
  redirect(`/e/${eventSlug}/matches`);
}
