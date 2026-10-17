import { Intent } from "./intent";
import { boundedItems, boundedText, LIMITS, ValidationError } from "../shared/validation";

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

export function validateProfile(input: ParticipantProfileInput): ParticipantProfileInput {
  if (!input.eventId || !input.attendeeId) throw new ValidationError(null, "Participant and event are required");
  if (!Object.values(Intent).includes(input.intent)) throw new ValidationError("intent", "Choose a valid networking intent");
  if (!Array.isArray(input.interests)) throw new ValidationError("interests", "Interests must be a list");
  const years = input.yearsOfExperience;
  if (years != null && (!Number.isInteger(years) || years < 0 || years > LIMITS.yearsOfExperience)) {
    throw new ValidationError("yearsOfExperience", `Years of experience must be a whole number from 0 to ${LIMITS.yearsOfExperience}`);
  }
  return {
    ...input,
    designation: boundedText(input.designation, "designation", "Role or designation", LIMITS.designation, { required: true }),
    domain: boundedText(input.domain, "domain", "Professional domain", LIMITS.domain, { required: true }),
    aboutMe: boundedText(input.aboutMe, "aboutMe", "About you", LIMITS.aboutMe, { required: true }),
    selfDescription: boundedText(input.selfDescription, "selfDescription", "Current focus", LIMITS.selfDescription),
    mostImpressiveBuild: boundedText(input.mostImpressiveBuild, "mostImpressiveBuild", "Most impressive build", LIMITS.mostImpressiveBuild),
    venueZone: boundedText(input.venueZone, "venueZone", "Venue zone", LIMITS.zoneLength),
    interests: boundedItems(input.interests, "interests", "interests", { count: LIMITS.interestCount, length: LIMITS.interestLength }),
  };
}
