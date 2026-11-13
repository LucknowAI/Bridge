import { beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "@/src/infrastructure/resilience/circuit-breaker";
import { Bulkhead, BulkheadFullError } from "@/src/infrastructure/resilience/bulkhead";
import { GatewayEmbeddingProvider, GatewayLlmProvider, guardedCall, isTransient } from "@/src/infrastructure/providers/model-gateway";
import { LlmRerankStage } from "@/src/domain/matching/stages/llm-rerank.stage";
import type { ModelUsageLog } from "@/src/application/ports/model-usage";
import { Intent } from "@/src/domain/participant/intent";
import type { ParticipantProfile } from "@/src/domain/participant/participant.entity";

const usage = (): ModelUsageLog & { entries: Array<{ outcome: string }> } => {
  const entries: Array<{ outcome: string }> = [];
  return { entries, record: vi.fn((entry) => { entries.push(entry); }) };
};
const guards = (log = usage()) => ({ breaker: new CircuitBreaker("t"), bulkhead: new Bulkhead("t"), usage: log });
const viewer: ParticipantProfile = {
  eventId: "e", attendeeId: "v", name: "v", designation: null, domain: null, aboutMe: null, selfDescription: null,
  yearsOfExperience: null, mostImpressiveBuild: null, intent: Intent.NETWORKING, interests: [], venueZone: null, visible: true,
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("circuit breaker", () => {
  it("opens after repeated failures, then lets one trial call through", async () => {
    let now = 0;
    const breaker = new CircuitBreaker("p", { failureThreshold: 2, resetAfterMs: 1000 }, () => now);
    const fail = () => breaker.execute(async () => { throw new Error("down"); });
    await expect(fail()).rejects.toThrow("down");
    await expect(fail()).rejects.toThrow("down");
    await expect(breaker.execute(async () => "ok")).rejects.toBeInstanceOf(CircuitOpenError);
    now = 1000;
    expect(breaker.state).toBe("half-open");
    await expect(breaker.execute(async () => "ok")).resolves.toBe("ok");
    expect(breaker.state).toBe("closed");
  });
});

describe("bulkhead", () => {
  it("limits concurrency, queues briefly, and rejects when full", async () => {
    const bulkhead = new Bulkhead("p", { maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 50 });
    let release!: () => void;
    const first = bulkhead.run(() => new Promise<string>((resolve) => { release = () => resolve("first"); }));
    const second = bulkhead.run(async () => "second");
    await expect(bulkhead.run(async () => "third")).rejects.toBeInstanceOf(BulkheadFullError);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
  });

  it("gives up waiting after the queue timeout", async () => {
    const bulkhead = new Bulkhead("p", { maxConcurrent: 1, maxQueue: 5, queueTimeoutMs: 30 });
    const busy = bulkhead.run(() => new Promise((resolve) => setTimeout(resolve, 200)));
    await expect(bulkhead.run(async () => "late")).rejects.toBeInstanceOf(BulkheadFullError);
    await busy;
  });
});

describe("guarded provider calls", () => {
  it("retries a transient error and records every attempt", async () => {
    const log = usage();
    const call = vi.fn().mockRejectedValueOnce(new Error("Gemini embedding failed (429): slow down")).mockResolvedValue("ok");
    await expect(guardedCall({ provider: "p", operation: "embed:query", inputChars: 4, policy: { timeoutMs: 2000, retries: 1 }, guards: guards(log), call }))
      .resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(2);
    expect(log.entries.map((entry) => entry.outcome)).toEqual(["error", "ok"]);
  });

  it("does not retry a permanent error", async () => {
    const call = vi.fn().mockRejectedValue(new Error("Gemini embedding failed (400): bad request"));
    await expect(guardedCall({ provider: "p", operation: "x", inputChars: 0, policy: { timeoutMs: 2000, retries: 2 }, guards: guards(), call })).rejects.toThrow("(400)");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("aborts a call that exceeds its budget", async () => {
    const log = usage();
    const call = (signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    await expect(guardedCall({ provider: "p", operation: "x", inputChars: 0, policy: { timeoutMs: 10_000, retries: 2 }, budgetMs: 80, guards: guards(log), call })).rejects.toThrow(/timeout/);
    expect(log.entries.map((entry) => entry.outcome)).toEqual(["timeout"]);
  });

  it("classifies transient errors", () => {
    expect(isTransient(new Error("failed (503)"))).toBe(true);
    expect(isTransient(new TypeError("fetch failed"))).toBe(true);
    expect(isTransient(new Error("failed (401)"))).toBe(false);
  });
});

describe("gateway fallbacks", () => {
  it("returns no query embedding on failure (search uses words) but surfaces profile failures", async () => {
    const inner = { id: "m", embed: vi.fn().mockRejectedValue(new Error("failed (401)")) };
    const gateway = new GatewayEmbeddingProvider(inner, usage());
    await expect(gateway.embed("climate", "query")).resolves.toBeNull();
    await expect(gateway.embed("profile text", "profile")).rejects.toThrow("(401)");
    expect(gateway.id).toBe("m");
  });

  it("stops calling a failing model once its circuit opens", async () => {
    const inner = { id: "m", embed: vi.fn().mockRejectedValue(new Error("failed (500)")) };
    const gateway = new GatewayEmbeddingProvider(inner, usage());
    for (let i = 0; i < 6; i++) await gateway.embed("q", "query");
    const calls = inner.embed.mock.calls.length;
    await gateway.embed("q", "query");
    expect(inner.embed.mock.calls.length).toBe(calls);
  });

  it("skips the rerank when the request has too little time left", async () => {
    const rerank = vi.fn(async (_viewer, list) => list);
    const llm = new GatewayLlmProvider({ id: "llm", promptVersion: "p1", rerank }, usage());
    const candidate = { participant: { ...viewer, attendeeId: "c" }, score: 50, scoreBreakdown: {}, mutualInterest: false, reason: null };
    const result = await new LlmRerankStage(llm).execute(viewer, [candidate], "profile", { timeoutMs: 200 });
    expect(rerank).not.toHaveBeenCalled();
    expect(result.rankedBy).toBe("score");
    expect(result.candidates[0].reason).toBeTruthy();
  });
});
