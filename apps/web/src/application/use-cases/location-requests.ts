import { LOCATION_RULES } from "../../domain/connection/location.rules";
import type { IntroRepository } from "../ports/intro-repository";
import type { LocationRepository } from "../ports/location-repository";
import type { ParticipantRepository } from "../ports/participant-repository";
import type { RateLimiter } from "../ports/rate-limiter";

/** Asks an accepted connection where they are. */
export async function requestLocation(
  input: { eventId: string; introId: string; requesterId: string },
  dependencies: { intros: IntroRepository; participants: ParticipantRepository; locations: LocationRepository; limiter?: RateLimiter }
) {
  const intro = await dependencies.intros.findById(input.eventId, input.introId);
  if (!intro || intro.status !== "accepted") throw new Error("You can ask once the introduction is accepted");
  if (intro.requesterId !== input.requesterId && intro.recipientId !== input.requesterId) {
    throw new Error("This introduction does not belong to your account");
  }
  const recipientId = intro.requesterId === input.requesterId ? intro.recipientId : intro.requesterId;
  if (!(await dependencies.participants.hasEventAccess(input.eventId, recipientId))) throw new Error("This person is no longer part of the event");
  if (dependencies.limiter && !(await dependencies.limiter.consume(`location:${input.eventId}:${input.requesterId}`, LOCATION_RULES.perHour, 3600))) {
    throw new Error("You have asked several people where they are this hour. Please try again later.");
  }
  const created = await dependencies.locations.create({ eventId: input.eventId, introId: input.introId, requesterId: input.requesterId, recipientId });
  if (!created) throw new Error("You already asked; they have not replied yet");
  return created;
}

/** Replies to a request with a configured venue zone, or declines it (zone null). */
export async function answerLocation(
  input: { eventId: string; requestId: string; recipientId: string; zone: string | null; allowedZones: string[] },
  dependencies: { locations: LocationRepository }
) {
  if (input.zone !== null && !input.allowedZones.includes(input.zone)) throw new Error("Choose a venue zone configured for this event");
  if (!(await dependencies.locations.answer(input))) throw new Error("This request has expired or was already answered");
}
