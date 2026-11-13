import { describe, expect, it, vi } from "vitest";
import { SemanticScorer } from "@/src/domain/matching/scorers/semantic.scorer";
import { queryRelevance } from "@/src/domain/matching/search-query";
import { MatchingPipeline } from "@/src/domain/matching/pipeline";
import type { ParticipantRepository } from "@/src/application/ports/participant-repository";
import { Intent } from "@/src/domain/participant/intent";
import type { ParticipantProfile } from "@/src/domain/participant/participant.entity";

const person = (attendeeId: string, overrides: Partial<ParticipantProfile> = {}): ParticipantProfile => ({
  eventId: "event", attendeeId, name: attendeeId, designation: null, domain: "AI", aboutMe: "builds search tools", selfDescription: null,
  yearsOfExperience: null, mostImpressiveBuild: null, intent: Intent.NETWORKING, interests: [], venueZone: null, visible: true,
  profileComplete: true, revision: 1, ...overrides,
});

describe("embeddings from different models", () => {
  it("are never compared by the semantic scorer", () => {
    const scorer = new SemanticScorer();
    const a = person("a", { embedding: [1, 0], embeddingModel: "model-a" });
    expect(scorer.score(a, person("b", { embedding: [1, 0], embeddingModel: "model-a" }))).toBeCloseTo(1);
    // Same numbers, other model: falls back to the text overlap instead of a meaningless cosine.
    expect(scorer.score(a, person("c", { embedding: [1, 0], embeddingModel: "model-b", aboutMe: "unrelated words" }))).toBeLessThan(0.5);
  });

  it("make query relevance fall back to words", () => {
    const candidate = person("c", { embedding: [1, 0], embeddingModel: "old-model" });
    expect(queryRelevance(["nothing"], [1, 0], candidate, "new-model")).toBe(0);
    expect(queryRelevance(["search"], [1, 0], candidate, "new-model")).toBe(1);
    expect(queryRelevance(["nothing"], [1, 0], { ...candidate, embeddingModel: "new-model" }, "new-model")).toBeCloseTo(1);
  });

  it("are replaced: a profile embedded by another model is embedded again", async () => {
    const viewer = person("viewer", { embedding: [0, 1], embeddingModel: "old-model" });
    const participants = {
      findProfile: vi.fn(async () => viewer),
      listCandidates: vi.fn(async () => []),
      setEmbedding: vi.fn(),
    } as unknown as ParticipantRepository;
    const embeddings = { id: "new-model", embed: vi.fn(async () => [1, 0]) };
    const matches = { save: vi.fn(async () => true), listForParticipant: vi.fn() };
    const cache = { get: vi.fn(), set: vi.fn(), getVector: vi.fn(), setVector: vi.fn(), acquire: vi.fn(), release: vi.fn() };
    await new MatchingPipeline(participants, matches, embeddings, null, cache).run({ eventId: "event", participantId: "viewer", mode: "profile" });
    expect(embeddings.embed).toHaveBeenCalledWith(expect.any(String), "profile");
    expect(participants.setEmbedding).toHaveBeenCalledWith("event", "viewer", [1, 0], "new-model");
    expect(participants.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ embedding: [1, 0], embeddingModel: "new-model" }));
  });
});
