import { Intent } from "./intent";

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
  if (!input.eventId || !input.attendeeId) throw new Error("Participant and event are required");
  if (!Object.values(Intent).includes(input.intent)) throw new Error("Choose a valid networking intent");
  if (!Array.isArray(input.interests)) throw new Error("Interests must be a list");
  if (input.yearsOfExperience != null && (!Number.isInteger(input.yearsOfExperience) || input.yearsOfExperience < 0 || input.yearsOfExperience > 80)) {
    throw new Error("Years of experience must be between 0 and 80");
  }
  return {
    ...input,
    designation: clean(input.designation),
    domain: clean(input.domain),
    aboutMe: clean(input.aboutMe),
    selfDescription: clean(input.selfDescription),
    mostImpressiveBuild: clean(input.mostImpressiveBuild),
    venueZone: clean(input.venueZone),
    interests: [...new Set(input.interests.map((interest) => interest.trim()).filter(Boolean))].slice(0, 20),
  };
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 2000) : null;
}
