import { Intent } from "./intent";
import { boundedItems, boundedText, LIMITS, ValidationError } from "../shared/validation";
import { readProfileForm, type ProfileFormConfig } from "./profile-form";

export interface ParticipantProfile {
  eventId: string;
  attendeeId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  designation: string | null;
  domain: string | null;
  aboutMe: string | null;
  selfDescription: string | null;
  yearsOfExperience: number | null;
  mostImpressiveBuild: string | null;
  intent: Intent;
  interests: string[];
  venueZone: string | null;
  visible: boolean;
  profileComplete?: boolean;
  /** When the profile was last saved; part of cached explanation keys. */
  profileRevision?: string | null;
  /** Version of the event's profile form this profile was saved under. */
  formVersion?: number;
  embedding?: number[] | null;
}

export type ParticipantProfileInput = Pick<
  ParticipantProfile,
  | "eventId"
  | "attendeeId"
  | "designation"
  | "domain"
  | "aboutMe"
  | "selfDescription"
  | "yearsOfExperience"
  | "mostImpressiveBuild"
  | "intent"
  | "interests"
  | "venueZone"
  | "formVersion"
>;

export function profileText(profile: ParticipantProfile): string {
  return [
    profile.name,
    profile.designation,
    profile.domain,
    profile.aboutMe,
    profile.selfDescription,
    profile.mostImpressiveBuild,
    profile.interests.join(" "),
    profile.intent,
  ]
    .filter(Boolean)
    .join("\n");
}

export function validateProfile(input: ParticipantProfileInput, form: ProfileFormConfig = readProfileForm({})): ParticipantProfileInput {
  // Required fields and their labels come from the event's profile form.
  const text = (key: "designation" | "domain" | "aboutMe" | "selfDescription" | "mostImpressiveBuild", value: string | null, limit: number) =>
    boundedText(value, key, form.fields[key].label, limit, { required: form.fields[key].required });
  if (!input.eventId || !input.attendeeId) throw new ValidationError(null, "Participant and event are required");
  if (!Object.values(Intent).includes(input.intent)) throw new ValidationError("intent", "Choose a valid networking intent");
  if (!Array.isArray(input.interests)) throw new ValidationError("interests", "Interests must be a list");
  const years = input.yearsOfExperience;
  if (years == null && form.fields.yearsOfExperience.required) {
    throw new ValidationError("yearsOfExperience", `${form.fields.yearsOfExperience.label} is required`);
  }
  if (years != null && (!Number.isInteger(years) || years < 0 || years > LIMITS.yearsOfExperience)) {
    throw new ValidationError("yearsOfExperience", `Years of experience must be a whole number from 0 to ${LIMITS.yearsOfExperience}`);
  }
  const interests = boundedItems(input.interests, "interests", "interests", { count: LIMITS.interestCount, length: LIMITS.interestLength });
  if (!interests.length && form.fields.interests.required) throw new ValidationError("interests", `${form.fields.interests.label} is required`);
  return {
    ...input,
    designation: text("designation", input.designation, LIMITS.designation),
    domain: text("domain", input.domain, LIMITS.domain),
    aboutMe: text("aboutMe", input.aboutMe, LIMITS.aboutMe),
    selfDescription: text("selfDescription", input.selfDescription, LIMITS.selfDescription),
    mostImpressiveBuild: text("mostImpressiveBuild", input.mostImpressiveBuild, LIMITS.mostImpressiveBuild),
    venueZone: boundedText(input.venueZone, "venueZone", "Venue zone", LIMITS.zoneLength),
    interests,
    formVersion: form.version,
  };
}
