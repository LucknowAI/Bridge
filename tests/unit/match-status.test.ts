import { describe, expect, it } from "vitest";
import { isInProgress, queueState, STUCK_AFTER_MS, summarizeQueue, type JobSnapshot } from "@/src/domain/matching/match-status";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const job = (overrides: Partial<JobSnapshot>): JobSnapshot => ({ type: "match", status: "pending", startedAt: null, ...overrides });
const startedAgo = (ms: number) => new Date(NOW - ms);

describe("queueState", () => {
  it.each([
    ["no job yet", null, "none"],
    ["a pending job", job({ status: "pending" }), "queued"],
    ["a job that just started", job({ status: "running", startedAt: startedAgo(60_000) }), "running"],
    ["a job running past the limit", job({ status: "running", startedAt: startedAgo(STUCK_AFTER_MS + 1) }), "stuck"],
    ["a job with retries used up", job({ status: "failed" }), "failed"],
    ["a finished match job", job({ status: "done" }), "done"],
    ["a finished embed job (match job follows)", job({ type: "embed", status: "done" }), "queued"],
  ] as const)("reports %s as %s", (_label, snapshot, expected) => {
    expect(queueState(snapshot, NOW)).toBe(expected);
  });

  it("only treats queued and running as in progress", () => {
    expect((["queued", "running"] as const).every(isInProgress)).toBe(true);
    expect((["none", "stuck", "failed", "done"] as const).some(isInProgress)).toBe(false);
  });
});

describe("summarizeQueue", () => {
  it("counts each participant's latest job by state", () => {
    expect(summarizeQueue([
      job({ status: "pending" }),
      job({ type: "embed", status: "done" }),
      job({ status: "running", startedAt: startedAgo(1000) }),
      job({ status: "running", startedAt: startedAgo(STUCK_AFTER_MS * 2) }),
      job({ status: "failed" }),
      job({ status: "done" }),
      job({ status: "done" }),
    ], NOW)).toEqual({ queued: 2, running: 1, stuck: 1, failed: 1, done: 2 });
  });
});
