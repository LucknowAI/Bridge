"use server";

import { upsertParticipant } from "../../src/application/use-cases/upsert-participant";
import { getContainer } from "../../src/composition/container";
import { Intent } from "../../src/domain/participant/intent";
import { getSession } from "../../lib/session";
import { clearSession } from "../../lib/session";
import { redirect } from "next/navigation";

export async function saveParticipantProfile(eventSlug: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Sign in before saving your profile");
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event || event.status !== "open") throw new Error("This event is not accepting profiles");
  if (!(await container.participants.hasEventAccess(event.id, session.attendeeId))) {
    throw new Error("You are not on this event's registration list");
  }

  const intentValue = String(formData.get("intent") || Intent.NETWORKING);
  if (!event.intents.includes(intentValue) || !Object.values(Intent).includes(intentValue as Intent)) {
    throw new Error("Choose an intent configured for this event");
  }
  const venueZone = nullable(formData.get("venueZone"));
  if (venueZone && !event.zones.includes(venueZone)) throw new Error("Choose a venue zone configured for this event");
  const profile = await upsertParticipant({
    eventId: event.id,
    attendeeId: session.attendeeId,
    intent: intentValue as Intent,
    interests: String(formData.get("interests") || "").split(",").map((value) => value.trim()).filter(Boolean),
    venueZone,
    aboutMe: nullable(formData.get("aboutMe")),
    designation: nullable(formData.get("designation")),
    domain: nullable(formData.get("domain")),
    selfDescription: nullable(formData.get("selfDescription")),
    yearsOfExperience: parseYears(formData.get("yearsOfExperience")),
    mostImpressiveBuild: nullable(formData.get("mostImpressiveBuild")),
  }, { participants: container.participants, enqueueMatching: container.enqueueEmbedding });
  return { ok: true, eventSlug, profileName: profile.name };
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
  if (!Number.isInteger(years)) throw new Error("Years of experience must be a whole number");
  return years;
}
