import { describe, expect, it, vi } from "vitest";
import { MATCHING_PIPELINE_VERSION, MatchingPipeline } from "@/src/domain/matching/pipeline";
import type { LlmProvider } from "@/src/application/ports/llm-provider";
import type { MatchRepository } from "@/src/application/ports/match-repository";
import type { ParticipantRepository } from "@/src/application/ports/participant-repository";
import { Intent } from "@/src/domain/participant/intent";
import type { ParticipantProfile } from "@/src/domain/participant/participant.entity";

const profile = (attendeeId: string, overrides: Partial<ParticipantProfile> = {}): ParticipantProfile => ({
  eventId: "event", attendeeId, name: attendeeId, designation: null, domain: null, aboutMe: null,
  selfDescription: null, yearsOfExperience: null, mostImpressiveBuild: null,
  intent: Intent.NETWORKING, interests: [], venueZone: null, visible: true, profileComplete: true, embedding: null, ...overrides,
});

// "strong" outscores "weak" on domain and shared interests, so score order is strong → weak.
const viewer = profile("viewer", { domain: "Machine Learning", interests: ["rag", "agents"] });
const strong = profile("strong", { domain: "Machine Learning", interests: ["rag", "agents"] });
const weak = profile("weak", { domain: "Cybersecurity", interests: ["kubernetes"] });

function setup(llm: LlmProvider | null) {
  const participants = {
    findProfile: vi.fn(async () => viewer),
    listCandidates: vi.fn(async () => [weak, strong]),
    setEmbedding: vi.fn(),
  } as unknown as ParticipantRepository;
  const matches = { save: vi.fn(), listForParticipant: vi.fn() } satisfies MatchRepository;
  const embeddings = { embed: vi.fn(async () => null) };
  const cache = { get: vi.fn(), set: vi.fn() };
  const pipeline = new MatchingPipeline(participants, matches, embeddings, llm, cache);
  return { pipeline, matches };
}

const run = (pipeline: MatchingPipeline) =>
  pipeline.run({ eventId: "event", participantId: "viewer", mode: "profile" });
const ids = (candidates: Array<{ participant: ParticipantProfile }>) => candidates.map((c) => c.participant.attendeeId);

describe("matching pipeline persistence", () => {
  it("persists the reranked order, not the numeric score order", async () => {
    const llm: LlmProvider = {
      id: "test-model",
      rerank: vi.fn(async (_viewer, candidates) => [...candidates].reverse()),
    };
    const { pipeline, matches } = setup(llm);
    const result = await run(pipeline);

    expect(result[0].score).toBeLessThan(result[1].score);
    expect(ids(result)).toEqual(["weak", "strong"]);
    const [, , saved, version] = matches.save.mock.calls[0];
    expect(ids(saved)).toEqual(["weak", "strong"]);
    expect(version).toBe(`${MATCHING_PIPELINE_VERSION}+llm:test-model`);
  });

  it("records the scored fallback and keeps a reason for every match", async () => {
    const llm: LlmProvider = { id: "test-model", rerank: vi.fn(async () => { throw new Error("timeout"); }) };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pipeline, matches } = setup(llm);
    await run(pipeline);

    const [, , saved, version] = matches.save.mock.calls[0];
    expect(ids(saved)).toEqual(["strong", "weak"]);
    expect(version).toBe(`${MATCHING_PIPELINE_VERSION}+score`);
    expect(saved.every((candidate: { reason: string | null }) => Boolean(candidate.reason))).toBe(true);
  });

  it("fills a reason the model left out", async () => {
    const llm: LlmProvider = { id: "test-model", rerank: vi.fn(async (_viewer, candidates) => candidates) };
    const { pipeline } = setup(llm);
    const result = await run(pipeline);
    expect(result.every((candidate) => Boolean(candidate.reason))).toBe(true);
  });
});
