import { describe, expect, it, vi } from "vitest";
import { EmfMetrics, MeteredModelUsageLog } from "@/src/infrastructure/observability/emf-metrics";
import { searchParticipants } from "@/src/application/use-cases/search-participants";
import type { Metrics } from "@/src/application/ports/metrics";

describe("embedded metric format", () => {
  it("writes one line CloudWatch turns into metrics", () => {
    const lines: string[] = [];
    new EmfMetrics("MatchMaker/test", (line) => lines.push(line)).record(
      [{ name: "SearchLatencyMs", value: 120, unit: "Milliseconds" }, { name: "SearchFailures", value: 0, unit: "Count" }],
      { Operation: "rerank" });
    const line = JSON.parse(lines[0]);
    expect(line._aws.CloudWatchMetrics).toEqual([{
      Namespace: "MatchMaker/test",
      Dimensions: [["Operation"]],
      Metrics: [{ Name: "SearchLatencyMs", Unit: "Milliseconds" }, { Name: "SearchFailures", Unit: "Count" }],
    }]);
    expect(line).toMatchObject({ Operation: "rerank", SearchLatencyMs: 120, SearchFailures: 0 });
  });

  it("writes nothing without a namespace", () => {
    const write = vi.fn();
    new EmfMetrics(null, write).record([{ name: "JobsPending", value: 3, unit: "Count" }]);
    expect(write).not.toHaveBeenCalled();
  });

  it("counts model calls and failures per operation, and still records usage", () => {
    const metrics = { record: vi.fn() };
    const inner = { record: vi.fn() };
    const entry = { provider: "gemini", operation: "embed", outcome: "timeout" as const, latencyMs: 900, inputChars: 10 };
    new MeteredModelUsageLog(inner, metrics).record(entry);
    expect(inner.record).toHaveBeenCalledWith(entry);
    expect(metrics.record).toHaveBeenCalledWith(expect.arrayContaining([
      { name: "ModelCallFailures", value: 1, unit: "Count" },
      { name: "ModelCallLatencyMs", value: 900, unit: "Milliseconds" },
    ]), { Operation: "embed" });
  });
});

describe("search metrics", () => {
  const deps = (run: () => Promise<unknown>) => {
    const metrics: Metrics & { record: ReturnType<typeof vi.fn> } = { record: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { metrics, pipeline: { run } as any, participants: { listDomains: vi.fn(async () => []) } as any };
  };
  const search = (d: ReturnType<typeof deps>) => searchParticipants({ eventId: "e", participantId: "p", query: "climate", eventIntents: [] }, d);
  const failures = (d: ReturnType<typeof deps>) => d.metrics.record.mock.calls[0][0].find((metric: { name: string }) => metric.name === "SearchFailures").value;

  it("records how long a search took", async () => {
    const d = deps(async () => []);
    await search(d);
    expect(failures(d)).toBe(0);
    expect(d.metrics.record.mock.calls[0][0][0]).toMatchObject({ name: "SearchLatencyMs", unit: "Milliseconds" });
  });

  it("records a failed search and still fails it", async () => {
    const d = deps(async () => { throw new Error("database down"); });
    await expect(search(d)).rejects.toThrow("database down");
    expect(failures(d)).toBe(1);
  });
});
