import { describe, expect, it, vi } from "vitest";
import { MatchingPipeline } from "@/src/domain/matching/pipeline";
import { IntentFilterStage } from "@/src/domain/matching/stages/intent-filter.stage";
import { requestIntro } from "@/src/application/use-cases/request-intro";
import type { IntroRepository } from "@/src/application/ports/intro-repository";
import type { MatchRepository } from "@/src/application/ports/match-repository";
import type { ParticipantRepository } from "@/src/application/ports/participant-repository";
import { Intent } from "@/src/domain/participant/intent";
import type { ParticipantProfile } from "@/src/domain/participant/participant.entity";

const profile = (attendeeId: string, overrides: Partial<ParticipantProfile> = {}): ParticipantProfile => ({
  eventId: "event", attendeeId, name: attendeeId, designation: null, domain: null, aboutMe: null,
  selfDescription: null, yearsOfExperience: null, mostImpressiveBuild: null,
  intent: Intent.NETWORKING, interests: [], venueZone: null, visible: true, profileComplete: true,
  embedding: null, ...overrides,
});

const eligible = profile("eligible");
const hidden = profile("hidden", { visible: false });
const incomplete = profile("incomplete", { profileComplete: false });

describe("candidate eligibility filter", () => {
  it("drops hidden and incomplete candidates", () => {
    const kept = new IntentFilterStage().execute(profile("viewer"), [eligible, hidden, incomplete]);
    expect(kept.map((candidate) => candidate.attendeeId)).toEqual(["eligible"]);
  });
});

describe("matching pipeline viewer", () => {
  function setup(viewer: ParticipantProfile | null) {
    const participants = {
      findProfile: vi.fn(async () => viewer),
      listCandidates: vi.fn(async () => [eligible, hidden, incomplete]),
      findCandidatesByIds: vi.fn(async (_event: string, ids: string[]) => [eligible, hidden, incomplete].filter((p) => ids.includes(p.attendeeId))),
      corpusRevision: vi.fn(async () => 1),
      setEmbedding: vi.fn(),
    } as unknown as ParticipantRepository;
    const matches = { save: vi.fn(), listForParticipant: vi.fn() } satisfies MatchRepository;
    const embeddings = { id: "test-embeddings", embed: vi.fn(async () => null) };
    const cache = {
      get: vi.fn(async () => null), set: vi.fn(async () => {}), getVector: vi.fn(async () => null), setVector: vi.fn(async () => {}),
      acquire: vi.fn(async () => "token"), release: vi.fn(async () => {}),
    };
    return { pipeline: new MatchingPipeline(participants, matches, embeddings, null, cache), matches };
  }
  const run = (pipeline: MatchingPipeline, mode: "profile" | "search") =>
    pipeline.run({ eventId: "event", participantId: "viewer", mode, query: "rag" });

  it.each(["profile", "search"] as const)("refuses an unsaved profile in %s mode", async (mode) => {
    const { pipeline, matches } = setup(profile("viewer", { profileComplete: false }));
    await expect(run(pipeline, mode)).rejects.toThrow("Complete your event profile");
    expect(matches.save).not.toHaveBeenCalled();
  });

  it("refuses a participant with no event profile", async () => {
    await expect(run(setup(null).pipeline, "search")).rejects.toThrow("Complete your event profile");
  });

  it("lets a hidden viewer browse eligible candidates only", async () => {
    const { pipeline } = setup(profile("viewer", { visible: false }));
    const result = await run(pipeline, "search");
    expect(result.map((match) => match.participant.attendeeId)).toEqual(["eligible"]);
  });
});

describe("intro request recipient", () => {
  function setup(recipient: ParticipantProfile) {
    const participants = {
      hasEventAccess: vi.fn(async () => true),
      findProfile: vi.fn(async (_eventId: string, id: string) => (id === "requester" ? profile("requester") : recipient)),
    } as unknown as ParticipantRepository;
    const intros = {
      create: vi.fn(async () => ({ id: "intro" })), findBetween: vi.fn(async () => []), countPendingOutgoing: vi.fn(async () => 0),
    } as unknown as IntroRepository;
    return { participants, intros };
  }
  const send = (dependencies: ReturnType<typeof setup>, recipientId: string) =>
    requestIntro({ eventId: "event", requesterId: "requester", recipientId }, dependencies);

  it.each([hidden, incomplete])("refuses an unavailable recipient ($attendeeId)", async (recipient) => {
    const dependencies = setup(recipient);
    await expect(send(dependencies, recipient.attendeeId)).rejects.toThrow("unavailable");
    expect(dependencies.intros.create).not.toHaveBeenCalled();
  });

  it("creates the request for an eligible recipient", async () => {
    const dependencies = setup(eligible);
    await expect(send(dependencies, "eligible")).resolves.toEqual({ id: "intro" });
  });
});
