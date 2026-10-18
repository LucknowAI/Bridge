"use server";

import { upsertParticipant } from "../../src/application/use-cases/upsert-participant";
import { getContainer } from "../../src/composition/container";
import { assertEventAllows } from "../../src/domain/shared/event-lifecycle";
import { Intent } from "../../src/domain/participant/intent";
import { ValidationError } from "../../src/domain/shared/validation";
import { clearSession, getSession } from "../../lib/session";
import { runFormAction, type FormState } from "../../lib/form-state";
import { redirect } from "next/navigation";

export async function saveParticipantProfile(eventSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(formData, async () => {
    await saveProfile(eventSlug, formData);
    redirect(`/e/${eventSlug}/matches?saved=1`);
  });
}

async function saveProfile(eventSlug: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in before saving your profile");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || !(await container.participants.hasEventAccess(event.id, session.attendeeId))) {
    throw new Error("You are not on this event's registration list");
  }
  assertEventAllows(event.status, "saveProfile");

  const intentValue = String(formData.get("intent") || Intent.NETWORKING);
  if (!event.intents.includes(intentValue) || !Object.values(Intent).includes(intentValue as Intent)) {
    throw new ValidationError("intent", "Choose an intent configured for this event");
  }
  const venueZone = nullable(formData.get("venueZone"));
  if (venueZone && !event.zones.includes(venueZone)) throw new ValidationError("venueZone", "Choose a venue zone configured for this event");
  await upsertParticipant({
    eventId: event.id,
    attendeeId: session.attendeeId,
    intent: intentValue as Intent,
    interests: String(formData.get("interests") || "").split(","),
    venueZone,
    aboutMe: nullable(formData.get("aboutMe")),
    designation: nullable(formData.get("designation")),
    domain: nullable(formData.get("domain")),
    selfDescription: nullable(formData.get("selfDescription")),
    yearsOfExperience: parseYears(formData.get("yearsOfExperience")),
    mostImpressiveBuild: nullable(formData.get("mostImpressiveBuild")),
  }, { participants: container.participants, enqueueMatching: container.enqueueEmbedding });
}

export async function signOutCurrentUser() {
  await clearSession();
  redirect("/login");
}

function nullable(value: FormDataEntryValue | null): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function parseYears(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const years = Number(text);
  if (!Number.isInteger(years)) throw new ValidationError("yearsOfExperience", "Years of experience must be a whole number");
  return years;
}
