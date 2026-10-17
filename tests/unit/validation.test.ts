import { describe, expect, it, vi } from "vitest";
import { boundedList, boundedText, LIMITS, ValidationError } from "@/src/domain/shared/validation";
import { validateProfile, type ParticipantProfileInput } from "@/src/domain/participant/participant.entity";
import { Intent } from "@/src/domain/participant/intent";
import { createEvent, updateEvent } from "@/src/application/use-cases/manage-event";
import { searchParticipants } from "@/src/application/use-cases/search-participants";
import type { EventRepository } from "@/src/application/ports/event-repository";
import type { MatchingPipeline } from "@/src/domain/matching/pipeline";

/** Runs `action` and returns the ValidationError it throws. */
async function rejection(action: () => unknown): Promise<ValidationError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error("expected a ValidationError");
}

describe("boundedText", () => {
  it("trims text and turns blanks into null", () => {
    expect(boundedText("  hello ", "f", "Field", 10)).toBe("hello");
    expect(boundedText("   ", "f", "Field", 10)).toBeNull();
    expect(boundedText(null, "f", "Field", 10)).toBeNull();
  });

  it("rejects over-long text instead of cutting it", async () => {
    const error = await rejection(() => boundedText("x".repeat(11), "about", "About", 10));
    expect(error).toMatchObject({ field: "about", message: "About must be 10 characters or fewer" });
  });

  it("enforces required and minimum length", async () => {
    expect((await rejection(() => boundedText("", "name", "Name", 10, { required: true }))).message).toBe("Name is required");
    expect((await rejection(() => boundedText("a", "name", "Name", 10, { min: 2 }))).field).toBe("name");
  });
});

describe("boundedList", () => {
  it("drops blanks and duplicates", () => {
    expect(boundedList(" a, b ,, a ", "zones", "zones", { count: 5, length: 5 })).toEqual(["a", "b"]);
  });

  it("rejects too many or too long items", async () => {
    expect((await rejection(() => boundedList("a,b,c", "zones", "zones", { count: 2, length: 5 }))).field).toBe("zones");
    expect((await rejection(() => boundedList("abcdef", "zones", "zones", { count: 2, length: 5 }))).field).toBe("zones");
  });
});

describe("validateProfile", () => {
  const input = (overrides: Partial<ParticipantProfileInput> = {}): ParticipantProfileInput => ({
    eventId: "event", attendeeId: "attendee", designation: "Engineer", domain: "AI", aboutMe: "I build things",
    selfDescription: null, yearsOfExperience: 3, mostImpressiveBuild: null, intent: Intent.NETWORKING,
    interests: ["rag", " rag ", ""], venueZone: null, ...overrides,
  });

  it("accepts a filled profile and cleans the interests", () => {
    expect(validateProfile(input()).interests).toEqual(["rag"]);
  });

  it.each([
    ["designation", { designation: " " }],
    ["aboutMe", { aboutMe: "x".repeat(LIMITS.aboutMe + 1) }],
    ["yearsOfExperience", { yearsOfExperience: 81 }],
    ["interests", { interests: Array.from({ length: LIMITS.interestCount + 1 }, (_, i) => `topic ${i}`) }],
  ] as const)("names the %s field when it is invalid", async (field, overrides) => {
    expect((await rejection(() => validateProfile(input(overrides)))).field).toBe(field);
  });
});

describe("event settings", () => {
  const events = {
    findOrganization: vi.fn(async () => ({ id: "org" })),
    hasOrganizationAccess: vi.fn(async () => true),
    isOrganizer: vi.fn(async () => true),
    create: vi.fn(async (record) => record),
    update: vi.fn(async (record) => record),
  } as unknown as EventRepository;
  const create = (overrides: Record<string, string>) =>
    createEvent({ organizationSlug: "org", organizerId: "me", name: "AI Meetup", ...overrides }, events);
  const update = (overrides: Record<string, unknown>) =>
    updateEvent({ eventId: "event", organizerId: "me", ...overrides }, events);

  it("builds the slug from the name and clears a blank description", async () => {
    await expect(create({ description: " " })).resolves.toMatchObject({ slug: "ai-meetup", description: null });
  });

  it.each([
    ["name", { name: "A" }],
    ["slug", { slug: "!!!", name: "??" }],
    ["description", { description: "x".repeat(LIMITS.eventDescription + 1) }],
  ] as const)("rejects an invalid %s on create", async (field, overrides) => {
    expect((await rejection(() => create(overrides))).field).toBe(field);
  });

  it("normalises intents and zones on update", async () => {
    await expect(update({ intents: ["networking", " hiring "], zones: ["Hall", "", "Hall"] }))
      .resolves.toMatchObject({ intents: ["NETWORKING", "HIRING"], zones: ["Hall"] });
  });

  it.each([
    ["intents", { intents: ["PARTYING"] }],
    ["intents", { intents: [""] }],
    ["zones", { zones: Array.from({ length: LIMITS.zoneCount + 1 }, (_, i) => `Zone ${i}`) }],
  ] as const)("rejects invalid %s on update", async (field, overrides) => {
    expect((await rejection(() => update(overrides))).field).toBe(field);
  });
});

describe("search query", () => {
  const pipeline = { run: vi.fn(async () => []) } as unknown as MatchingPipeline;
  const search = (query: string) => searchParticipants({ eventId: "event", participantId: "me", query }, { pipeline });

  it("passes the trimmed query to the pipeline", async () => {
    await search("  climate AI ");
    expect(pipeline.run).toHaveBeenCalledWith(expect.objectContaining({ query: "climate AI", mode: "search" }));
  });

  it("rejects blank and over-long queries", async () => {
    expect((await rejection(() => search("  "))).field).toBe("query");
    expect((await rejection(() => search("x".repeat(LIMITS.searchQuery + 1)))).field).toBe("query");
  });
});
