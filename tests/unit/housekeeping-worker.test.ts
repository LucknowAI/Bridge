import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sweepExpired: vi.fn() }));
vi.mock("../../packages/db/src/index", () => ({ housekeeping: { sweepExpired: mocks.sweepExpired } }));

import { SWEEP_EVERY_MS, sweepIfDue } from "../../packages/db/workers/housekeeping.worker";

describe("hourly housekeeping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("sweeps on the first loop, then at most once per interval, and survives a failure", async () => {
    const start = 1_000_000_000_000;
    mocks.sweepExpired.mockResolvedValue({ loginChallenges: 0, rateLimitBuckets: 0, retrievalCache: 0 });

    expect(await sweepIfDue(start)).toBe(true);
    expect(await sweepIfDue(start + SWEEP_EVERY_MS - 1)).toBe(false);
    expect(mocks.sweepExpired).toHaveBeenCalledTimes(1);

    mocks.sweepExpired.mockRejectedValueOnce(new Error("database restarting"));
    await expect(sweepIfDue(start + SWEEP_EVERY_MS)).resolves.toBe(true);
    expect(mocks.sweepExpired).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalled();
  });
});
