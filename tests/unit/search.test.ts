import { describe, expect, it, vi } from "vitest";
import { MatchingPipeline } from "@/src/domain/matching/pipeline";
import {
  lexicalRelevance, lexicalTsQuery, matchesFilters, normalizeFilters, queryRelevance, queryTerms, searchScore,
} from "@/src/domain/matching/search-query";
import type { ParticipantRepository } from "@/src/application/ports/participant-repository";
import { Intent } from "@/src/domain/participant/intent";
import type { ParticipantProfile } from "@/src/domain/participant/participant.entity";
import { ValidationError } from "@/src/domain/shared/validation";

const profile = (attendeeId: string, overrides: Partial<ParticipantProfile> = {}): ParticipantProfile => ({
  eventId: "event", attendeeId, name: attendeeId, designation: null, domain: null, aboutMe: null,
  selfDescription: null, yearsOfExperience: null, mostImpressiveBuild: null,
  intent: Intent.NETWORKING, interests: [], venueZone: null, visible: true, profileComplete: true, embedding: null, ...overrides,
});

const designer = profile("designer", { designation: "Product Designer", domain: "Design", aboutMe: "Designing climate tools", interests: ["climate"] });
const engineer = profile("engineer", { designation: "ML Engineer", domain: "AI", aboutMe: "Builds retrieval systems", interests: ["rag", "search"] });
const founder = profile("founder", { designation: "Founder", domain: "AI", aboutMe: "Hiring engineers", intent: Intent.HIRING, interests: ["search"] });

describe("query terms and relevance", () => {
  it("keeps meaningful words only", () => {
    expect(queryTerms("Someone working on Climate design, with RAG!")).toEqual(["climate", "design", "rag"]);
  });

  it("matches words by prefix against the profile", () => {
    expect(lexicalRelevance(["climat", "design"], designer)).toBe(1);
    expect(lexicalRelevance(["climate", "rag"], engineer)).toBe(0.5);
    expect(lexicalRelevance([], engineer)).toBe(0);
  });

  it("prefers semantic relevance when both vectors exist", () => {
    const withVector = { ...engineer, embedding: [1, 0] };
    expect(queryRelevance(["nothing"], [1, 0], withVector)).toBeCloseTo(1);
    expect(queryRelevance(["rag"], null, withVector)).toBe(1);
  });

  it("weights query relevance over personal compatibility", () => {
    expect(searchScore(1, 0)).toBe(60);
    expect(searchScore(0, 100)).toBe(40);
  });

  it("builds a prefix OR query from safe words", () => {
    expect(lexicalTsQuery(["climate", "ml"])).toBe("climate:* | ml:*");
    expect(lexicalTsQuery([])).toBeNull();
  });
});

describe("search filters", () => {
  const allowed = { intents: ["NETWORKING", "HIRING"], domains: ["AI", "Design"] };

  it("accepts the event's intents and present domains, matching case", () => {
    expect(normalizeFilters({ intent: "HIRING", domain: "ai" }, allowed)).toEqual({ intent: "HIRING", domain: "AI" });
    expect(normalizeFilters({}, allowed)).toEqual({ intent: null, domain: null });
  });

  it("rejects values outside the catalog", () => {
    expect(() => normalizeFilters({ intent: "INVESTING" }, allowed)).toThrow(ValidationError);
    expect(() => normalizeFilters({ domain: "Biotech" }, allowed)).toThrow(/Choose a domain/);
  });

  it("checks a profile against the filters", () => {
    expect(matchesFilters(founder, { intent: Intent.HIRING, domain: "ai" })).toBe(true);
    expect(matchesFilters(engineer, { intent: Intent.HIRING, domain: null })).toBe(false);
  });
});

function searchPipeline(candidates: ParticipantProfile[], viewer: ParticipantProfile, cached: string[] | null = null) {
  const participants = {
    findProfile: vi.fn(async () => viewer),
    listCandidates: vi.fn(async () => candidates),
    findCandidatesByIds: vi.fn(async (_event: string, ids: string[]) => candidates.filter((c) => ids.includes(c.attendeeId))),
    setEmbedding: vi.fn(),
  } as unknown as ParticipantRepository;
  const cache = { get: vi.fn(async () => cached), set: vi.fn() };
  const matches = { save: vi.fn(), listForParticipant: vi.fn() };
  const pipeline = new MatchingPipeline(participants, matches, { embed: vi.fn(async () => null) }, null, cache);
  return { pipeline, participants, cache, matches };
}

const search = (pipeline: MatchingPipeline, query: string, filters = { intent: null, domain: null }) =>
  pipeline.run({ eventId: "event", participantId: "viewer", mode: "search", query, filters }).then((ranked) => ranked.map((c) => c.participant.attendeeId));

describe("search pipeline", () => {
  const viewer = profile("viewer", { domain: "AI", interests: ["search"] });

  it("ranks by the query: different queries, different order", async () => {
    const { pipeline } = searchPipeline([designer, engineer, founder], viewer);
    expect((await search(pipeline, "climate designer"))[0]).toBe("designer");
    expect((await search(pipeline, "retrieval engineer"))[0]).toBe("engineer");
  });

  it("still ranks personally: the same query orders differently for different people", async () => {
    const twins = [profile("ai-person", { domain: "AI", interests: ["search"], aboutMe: "Builds products" }),
      profile("design-person", { domain: "Design", interests: ["climate"], aboutMe: "Builds products" })];
    const aiViewer = await search(searchPipeline(twins, profile("viewer", { domain: "AI", interests: ["search"] })).pipeline, "products");
    const designViewer = await search(searchPipeline(twins, profile("viewer", { domain: "Design", interests: ["climate"] })).pipeline, "products");
    expect(aiViewer[0]).toBe("ai-person");
    expect(designViewer[0]).toBe("design-person");
  });

  it("passes words and filters to retrieval, and keeps the searcher's profile for compatibility", async () => {
    const { pipeline, participants, matches } = searchPipeline([engineer], viewer);
    await search(pipeline, "RAG engineers", { intent: null, domain: "AI" });
    expect(participants.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ terms: ["rag", "engineers"], filters: { intent: null, domain: "AI" } }));
    expect(matches.save).not.toHaveBeenCalled();
  });

  it("applies filters to cache hits too", async () => {
    const { pipeline, participants } = searchPipeline([designer, engineer, founder], viewer, ["designer", "engineer", "founder"]);
    expect(await search(pipeline, "search", { intent: Intent.HIRING, domain: null })).toEqual(["founder"]);
    expect(participants.listCandidates).not.toHaveBeenCalled();
  });

  it("keys the shared cache by query and filters", async () => {
    const { pipeline, cache } = searchPipeline([engineer], viewer);
    await search(pipeline, "search");
    await search(pipeline, "  SEARCH ");
    await search(pipeline, "search", { intent: null, domain: "AI" });
    const keys = cache.set.mock.calls.map((call) => call[0]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
