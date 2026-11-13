import type { IntroRepository } from "../ports/intro-repository";
import type { ParticipantRepository } from "../ports/participant-repository";

export async function shareVenueZone(input: {
  eventId: string;
  introId: string;
  participantId: string;
  zone: string;
  allowedZones: string[];
}, dependencies: { intros: IntroRepository; participants: ParticipantRepository }) {
  const intro = await dependencies.intros.findById(input.eventId, input.introId);
  if (!intro || intro.status !== "accepted") throw new Error("Accept the introduction before sharing your location");
  if (intro.requesterId !== input.participantId && intro.recipientId !== input.participantId) {
    throw new Error("This introduction does not belong to your account");
  }
  if (!input.allowedZones.includes(input.zone)) throw new Error("Choose a venue zone configured for this event");
  await dependencies.participants.shareVenueZone(input.eventId, input.participantId, input.zone);
  return { shared: true, expiresInMinutes: 15 };
}
