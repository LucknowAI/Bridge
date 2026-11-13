import { validateProfile, type ParticipantProfileInput } from "../../domain/participant/participant.entity";
import { PROFILE_FIELD_KEYS, type ProfileFormConfig } from "../../domain/participant/profile-form";
import type { ParticipantRepository } from "../ports/participant-repository";

export async function upsertParticipant(
  input: ParticipantProfileInput,
  dependencies: { participants: ParticipantRepository },
  form?: ProfileFormConfig
) {
  let values = input;
  if (form && PROFILE_FIELD_KEYS.some((key) => !form.fields[key].shown)) {
    // A hidden field keeps what was saved before, so changing the form never wipes profiles.
    const existing = await dependencies.participants.findProfile(input.eventId, input.attendeeId);
    values = { ...input };
    for (const key of PROFILE_FIELD_KEYS) {
      if (!form.fields[key].shown) Object.assign(values, { [key]: existing?.[key] ?? (key === "interests" ? [] : null) });
    }
  }
  // saveProfile queues the embedding and matching in the same transaction.
  return dependencies.participants.saveProfile(validateProfile(values, form));
}
