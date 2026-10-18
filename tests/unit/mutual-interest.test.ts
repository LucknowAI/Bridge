import { describe, expect, it } from "vitest";
import { defaultScorers, MATCHING_PIPELINE_VERSION } from "@/src/domain/matching/pipeline";
import { isMutualInterest, SCORING_CONFIG } from "@/src/domain/matching/scoring-config";
import { ScoreStage } from "@/src/domain/matching/stages/score.stage";
import { Intent } from "@/src/domain/participant/intent";
import type { ParticipantProfile } from "@/src/domain/participant/participant.entity";

const person = (attendeeId: string, overrides: Partial<ParticipantProfile> = {}): ParticipantProfile => ({
  eventId: "event", attendeeId, name: attendeeId, designation: null, domain: null, aboutMe: null,
  selfDescription: null, yearsOfExperience: null, mostImpressiveBuild: null,
  intent: Intent.NETWORKING, interests: [], venueZone: null, visible: true, profileComplete: true, embedding: null, ...overrides,
});

const stage = new ScoreStage(defaultScorers());
const both = (a: ParticipantProfile, b: ParticipantProfile) => ({ forward: stage.pairScore(a, b).total, reverse: stage.pairScore(b, a).total });
const flag = (a: ParticipantProfile, b: ParticipantProfile) => stage.execute(a, [b])[0];

// Calibration examples behind SCORING_CONFIG.mutualInterestThreshold.
describe("mutual interest", () => {
  it("flags a pair that fits strongly in both directions", () => {
    const a = person("a", { domain: "AI", interests: ["rag", "agents"], aboutMe: "Builds retrieval agents" });
    const b = person("b", { domain: "AI", interests: ["rag", "agents"], aboutMe: "Researches retrieval agents" });
    const scores = both(a, b);
    expect(scores.forward).toBeGreaterThanOrEqual(SCORING_CONFIG.mutualInterestThreshold);
    expect(scores.reverse).toBeGreaterThanOrEqual(SCORING_CONFIG.mutualInterestThreshold);
    expect(flag(a, b).mutualInterest).toBe(true);
  });

  it("does not flag compatible goals alone", () => {
    const a = person("a", { intent: Intent.HIRING, domain: "Finance", interests: ["payments"] });
    const b = person("b", { intent: Intent.LOOKING_FOR_WORK, domain: "Biology", interests: ["genomics"] });
    expect(flag(a, b).mutualInterest).toBe(false);
  });

  it("does not flag a fit that holds only one way", () => {
    const narrow = person("narrow", { domain: "AI", interests: ["rag"] });
    const broad = person("broad", { domain: "AI", interests: ["rag", "solar", "policy", "finance"] });
    const scores = both(narrow, broad);
    expect(scores.forward).toBeGreaterThanOrEqual(SCORING_CONFIG.mutualInterestThreshold);
    expect(scores.reverse).toBeLessThan(SCORING_CONFIG.mutualInterestThreshold);
    expect(flag(narrow, broad).mutualInterest).toBe(false);
    expect(flag(broad, narrow).mutualInterest).toBe(false);
  });

  it("still decides without embeddings, and uses them when present", () => {
    const a = person("a", { domain: "AI", interests: ["rag"] });
    const b = person("b", { domain: "AI", interests: ["rag"] });
    const withoutVectors = flag(a, b);
    const withVectors = flag({ ...a, embedding: [1, 0] }, { ...b, embedding: [1, 0] });
    expect(withVectors.scoreBreakdown.semantic).toBe(1);
    expect(withVectors.score).toBeGreaterThan(withoutVectors.score);
    expect(withVectors.mutualInterest).toBe(true);
  });

  it("records the reverse score next to the forward breakdown", () => {
    const result = flag(person("a", { domain: "AI" }), person("b", { domain: "AI" }));
    expect(result.scoreBreakdown.reverse).toBeGreaterThan(0);
  });

  it("applies the threshold to both directions", () => {
    expect(isMutualInterest(0.9, 0.59, 0.6)).toBe(false);
    expect(isMutualInterest(0.6, 0.6, 0.6)).toBe(true);
  });

  it("puts the scoring version in the persisted computation version", () => {
    expect(MATCHING_PIPELINE_VERSION).toContain(SCORING_CONFIG.version);
  });
});
