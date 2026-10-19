import { describe, expect, it } from "vitest";
import { budgetFailures, percentile, type CapacityReport } from "../../tools/capacity-check";
import { HashEmbeddingProvider } from "@/src/infrastructure/providers/hash-embedding.provider";

const report = (overrides: Partial<CapacityReport> = {}): CapacityReport => ({
  attendees: 300, searches: 60, firstListsSeconds: 30, quietSeconds: 60, attendeesWithoutMatches: 0,
  search: { p50Ms: 200, p95Ms: 900, maxMs: 1200, failures: 0 },
  modelCalls: { perAttendee: 2, perSearch: 1, approxTokens: 1000, failures: 0 },
  ...overrides,
});

describe("capacity budgets", () => {
  it("passes a report within every budget", () => {
    expect(budgetFailures(report())).toEqual([]);
  });

  it("names each budget a report misses", () => {
    const failures = budgetFailures(report({
      search: { p50Ms: 3000, p95Ms: 7000, maxMs: 9000, failures: 2 },
      attendeesWithoutMatches: 1,
      modelCalls: { perAttendee: 9, perSearch: 1, approxTokens: 0, failures: 0 },
    }));
    expect(failures).toEqual([
      "search p95 7000 ms is over the budget of 6000 ms",
      "model calls per attendee 9 is over the budget of 6",
      "2 search(es) failed",
      "1 attendee(s) have no matches",
    ]);
  });

  it("takes nearest-rank percentiles", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile([], 95)).toBe(0);
  });
});

describe("hash embedding", () => {
  it("gives unit vectors that are closer for similar texts", async () => {
    const provider = new HashEmbeddingProvider();
    const [a, b, c] = await Promise.all(["graph databases in rust", "rust graph databases", "watercolor painting"].map((text) => provider.embed(text)));
    const dot = (x: number[], y: number[]) => x.reduce((sum, value, i) => sum + value * y[i], 0);
    expect(a).toHaveLength(768);
    expect(dot(a!, a!)).toBeCloseTo(1);
    expect(dot(a!, b!)).toBeGreaterThan(dot(a!, c!));
    expect(await provider.embed("  ")).toBeNull();
  });
});
