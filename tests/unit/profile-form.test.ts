import { describe, expect, it, vi } from "vitest";
import { buildProfileForm, missingRequiredFields, PROFILE_FIELD_KEYS, readProfileForm, type ProfileFieldSetting } from "@/src/domain/participant/profile-form";
import { validateProfile, type ParticipantProfileInput } from "@/src/domain/participant/participant.entity";
import { upsertParticipant } from "@/src/application/use-cases/upsert-participant";
import { Intent } from "@/src/domain/participant/intent";
import { ValidationError } from "@/src/domain/shared/validation";

const defaults = readProfileForm({});
const settings = (changes: Partial<Record<string, Partial<ProfileFieldSetting>>> = {}) =>
  Object.fromEntries(PROFILE_FIELD_KEYS.map((key) => [key, { ...defaults.fields[key], ...changes[key] }])) as Record<(typeof PROFILE_FIELD_KEYS)[number], ProfileFieldSetting>;

const input: ParticipantProfileInput = {
  eventId: "event", attendeeId: "attendee", designation: "Engineer", domain: "AI", aboutMe: "Builds things",
  selfDescription: null, yearsOfExperience: null, mostImpressiveBuild: null, intent: Intent.NETWORKING, interests: [], venueZone: null,
};

describe("readProfileForm", () => {
  it("defaults to today's form for events never configured or with bad data", () => {
    expect(defaults.version).toBe(0);
    expect(defaults.fields.aboutMe).toEqual({ shown: true, required: true, label: "About you" });
    expect(defaults.fields.interests).toEqual({ shown: true, required: false, label: "Interests" });
    expect(readProfileForm({ fields: { aboutMe: { shown: "yes", label: 42 } } }).fields.aboutMe.label).toBe("About you");
  });

  it("never treats a hidden field as required", () => {
    expect(readProfileForm({ fields: { domain: { shown: false, required: true } } }).fields.domain.required).toBe(false);
  });
});

describe("buildProfileForm", () => {
  it("bumps the version on every save", () => {
    expect(buildProfileForm(settings(), defaults).version).toBe(1);
    expect(buildProfileForm(settings(), { ...defaults, version: 4 }).version).toBe(5);
  });

  it("refuses a required hidden field", () => {
    expect(() => buildProfileForm(settings({ aboutMe: { shown: false, required: true } }), defaults)).toThrow(/cannot be required while it is hidden/);
  });

  it("keeps at least one descriptive field required for matching", () => {
    const none = settings(Object.fromEntries(["designation", "domain", "aboutMe"].map((key) => [key, { required: false }])));
    expect(() => buildProfileForm(none, defaults)).toThrow(ValidationError);
  });

  it("bounds labels and keeps the default for an empty one", () => {
    expect(() => buildProfileForm(settings({ domain: { label: "x".repeat(61) } }), defaults)).toThrow(/60 characters/);
    expect(buildProfileForm(settings({ domain: { label: "  " } }), defaults).fields.domain.label).toBe("Professional domain");
  });
});

describe("validateProfile with an event form", () => {
  const form = buildProfileForm(settings({
    aboutMe: { required: false }, interests: { required: true, label: "Topics" }, domain: { label: "Industry" },
  }), defaults);

  it("uses the event's required fields and labels", () => {
    expect(() => validateProfile({ ...input, aboutMe: null }, form)).toThrow(/Topics is required/);
    expect(() => validateProfile({ ...input, domain: null, interests: ["AI"] }, form)).toThrow(/Industry/);
    expect(validateProfile({ ...input, aboutMe: null, interests: ["AI"] }, form)).toMatchObject({ aboutMe: null, formVersion: 1 });
  });

  it("finds required answers missing from a profile saved under an older form", () => {
    expect(missingRequiredFields(form, { ...input, interests: [] })).toEqual(["interests"]);
  });
});

describe("upsertParticipant with hidden fields", () => {
  it("keeps what was saved before instead of wiping it", async () => {
    const form = buildProfileForm(settings({ mostImpressiveBuild: { shown: false, required: false } }), defaults);
    const participants = {
      findProfile: vi.fn().mockResolvedValue({ ...input, mostImpressiveBuild: "A search engine" }),
      saveProfile: vi.fn(async (profile) => profile),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertParticipant({ ...input, mostImpressiveBuild: null }, { participants: participants as any }, form);
    expect(participants.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ mostImpressiveBuild: "A search engine", formVersion: 1 }));
  });
});
