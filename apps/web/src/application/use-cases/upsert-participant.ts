import { validateProfile, type ParticipantProfileInput } from "../../domain/participant/participant.entity";
import type { ParticipantRepository } from "../ports/participant-repository";

export async function upsertParticipant(
  input: ParticipantProfileInput,
  dependencies: { participants: ParticipantRepository; enqueueMatching?: (eventId: string, participantId: string) => Promise<void> }
) {
  const profile = await dependencies.participants.saveProfile(validateProfile(input));
  await dependencies.enqueueMatching?.(profile.eventId, profile.attendeeId);
  return profile;
}
