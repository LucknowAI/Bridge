import { describe, expect, it, vi } from "vitest";
import { LlmRerankStage } from "@/src/domain/matching/stages/llm-rerank.stage";
import { explanationKey, queryContext } from "@/src/domain/matching/explanation-key";
import type { ExplanationCache } from "@/src/application/ports/explanation-cache";
import type { LlmProvider } from "@/src/application/ports/llm-provider";
import type { MatchCandidate } from "@/src/domain/matching/match-strategy";
import { Intent } from "@/src/domain/participant/intent";
import type { ParticipantProfile } from "@/src/domain/participant/participant.entity";

const person = (attendeeId: string, profileRevision = "r1"): ParticipantProfile => ({
  eventId: "event", attendeeId, name: attendeeId, designation: null, domain: "AI", aboutMe: null, selfDescription: null,
  yearsOfExperience: null, mostImpressiveBuild: null, intent: Intent.NETWORKING, interests: [], venueZone: null, visible: true,
  profileComplete: true, embedding: null, profileRevision,
});
const candidate = (profile: ParticipantProfile, score: number): MatchCandidate => ({ participant: profile, score, scoreBreakdown: {}, mutualInterest: false, reason: null });

function memoryCache(): ExplanationCache & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getMany: vi.fn(async (keys: string[]) => new Map(keys.filter((key) => store.has(key)).map((key) => [key, store.get(key)!]))),
    setMany: vi.fn(async (entries) => { for (const entry of entries) store.set(entry.key, entry.reason); }),
  };
}

function llm(): LlmProvider & { rerank: ReturnType<typeof vi.fn> } {
  return {
    id: "test:model",
    promptVersion: "p1",
    // Reverses the order and writes a reason naming the candidate.
    rerank: vi.fn(async (_viewer: ParticipantProfile, list: MatchCandidate[]) =>
      [...list].reverse().map((item) => ({ ...item, reason: `LLM says ${item.participant.attendeeId}` }))),
  };
}

const viewer = person("viewer");
const shortlist = () => [candidate(person("a"), 90), candidate(person("b"), 80)];
const order = (result: { candidates: MatchCandidate[] }) => result.candidates.map((item) => item.participant.attendeeId);

describe("pair explanation cache", () => {
  it("stores the model's reasons, then reuses them without calling the model", async () => {
    const cache = memoryCache();
    const provider = llm();
    const stage = new LlmRerankStage(provider, cache);

    const first = await stage.execute(viewer, shortlist());
    expect(order(first)).toEqual(["b", "a"]);
    expect(first.rankedBy).toBe("llm:test:model");
    expect(cache.store.size).toBe(2);

    const second = await stage.execute(viewer, shortlist());
    expect(provider.rerank).toHaveBeenCalledTimes(1);
    expect(second.candidates.map((item) => item.reason)).toEqual(["LLM says a", "LLM says b"]);
    // Cached reasons never carry the model's order: the scored order stands.
    expect(order(second)).toEqual(["a", "b"]);
    expect(second.rankedBy).toBe("score");
  });

  it("asks the model again when a profile changes", async () => {
    const cache = memoryCache();
    const provider = llm();
    const stage = new LlmRerankStage(provider, cache);
    await stage.execute(viewer, shortlist());
    await stage.execute(viewer, [candidate(person("a", "r2"), 90), candidate(person("b"), 80)]);
    expect(provider.rerank).toHaveBeenCalledTimes(2);
  });

  it("never reuses one viewer's explanations for another", async () => {
    const cache = memoryCache();
    const provider = llm();
    const stage = new LlmRerankStage(provider, cache);
    await stage.execute(viewer, shortlist());
    await stage.execute(person("someone-else"), shortlist());
    expect(provider.rerank).toHaveBeenCalledTimes(2);
  });

  it("keeps query explanations apart from profile ones and from other queries", () => {
    const base = { eventId: "event", viewer, candidate: person("a"), model: "m", promptVersion: "p1" };
    const profile = explanationKey({ ...base, context: "profile" });
    const climate = explanationKey({ ...base, context: queryContext(" Climate  tools") });
    expect(climate).toBe(explanationKey({ ...base, context: queryContext("climate tools") }));
    expect(new Set([profile, climate, explanationKey({ ...base, context: queryContext("finance") })]).size).toBe(3);
    expect(explanationKey({ ...base, context: "profile", promptVersion: "p2" })).not.toBe(profile);
  });

  it("falls back to cached reasons when the model fails", async () => {
    const cache = memoryCache();
    const provider = llm();
    const stage = new LlmRerankStage(provider, cache);
    await stage.execute(viewer, [candidate(person("a"), 90)]);
    provider.rerank.mockRejectedValueOnce(new Error("timeout"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await stage.execute(viewer, shortlist());
    expect(result.candidates.map((item) => item.reason)).toEqual(["LLM says a", expect.stringMatching(/perspective|fit/)]);
  });

  it("keeps working when the cache itself fails", async () => {
    const provider = llm();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken: ExplanationCache = { getMany: vi.fn().mockRejectedValue(new Error("down")), setMany: vi.fn().mockRejectedValue(new Error("down")) };
    const result = await new LlmRerankStage(provider, broken).execute(viewer, shortlist());
    expect(result.rankedBy).toBe("llm:test:model");
  });
});
