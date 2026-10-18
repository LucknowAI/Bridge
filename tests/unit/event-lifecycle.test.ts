import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertEventAllows, eventAllows, type EventAction, type EventStatus } from "@/src/domain/shared/event-lifecycle";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), complete: vi.fn(), fail: vi.fn(), statusOf: vi.fn(), computeMatches: vi.fn(),
}));
vi.mock("../../packages/db/src/index", () => ({
  events: { statusOf: mocks.statusOf },
  matchingJobs: { claim: mocks.claim, complete: mocks.complete, fail: mocks.fail },
}));
vi.mock("../../apps/web/src/composition/container", () => ({ getContainer: () => ({ pipeline: {} }) }));
vi.mock("../../apps/web/src/application/use-cases/compute-matches", () => ({ computeMatches: mocks.computeMatches }));

import { processMatchJob } from "../../packages/db/workers/match.worker";

// The agreed policy, row by row: [action, draft, open, closed].
const POLICY: Array<[EventAction, boolean, boolean, boolean]> = [
  ["saveProfile", false, true, false],
  ["search", false, true, false],
  ["refreshMatches", false, true, false],
  ["requestIntro", false, true, false],
  ["shareZone", false, true, false],
  ["viewMatches", false, true, true],
  ["respondToIntro", false, true, true],
  ["computeMatches", true, true, false],
  ["processJob", false, true, false],
];

describe("event lifecycle policy", () => {
  it.each(POLICY)("%s: draft=%s open=%s closed=%s", (action, draft, open, closed) => {
    const allowed = (status: EventStatus) => eventAllows(status, action);
    expect([allowed("draft"), allowed("open"), allowed("closed")]).toEqual([draft, open, closed]);
  });

  it("explains why an action is unavailable", () => {
    expect(() => assertEventAllows("draft", "search")).toThrow("Search becomes available when the event opens.");
    expect(() => assertEventAllows("closed", "requestIntro")).toThrow("Requesting introductions ended when the event closed.");
    expect(() => assertEventAllows("open", "search")).not.toThrow();
  });
});

describe("match worker", () => {
  const job = { id: 7, event_id: "event", participant_id: "attendee", attempts: 1, job_type: "match" };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.claim.mockResolvedValue(job);
  });

  it.each(["draft", "closed", null])("skips and completes a job when the event is %s", async (status) => {
    mocks.statusOf.mockResolvedValue(status);
    await expect(processMatchJob()).resolves.toBe(true);
    expect(mocks.computeMatches).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledWith(7);
  });

  it("computes matches while the event is open", async () => {
    mocks.statusOf.mockResolvedValue("open");
    await processMatchJob();
    expect(mocks.computeMatches).toHaveBeenCalledWith({ eventId: "event", participantId: "attendee" }, {});
    expect(mocks.complete).toHaveBeenCalledWith(7);
  });
});
