import { describe, expect, it, vi } from "vitest";
import { INTRO_LIMITS, introRequestRefusal } from "@/src/domain/connection/connection.rules";
import { requestIntro } from "@/src/application/use-cases/request-intro";
import type { IntroRequest } from "@/src/domain/connection/intro-request.entity";

const intro = (requesterId: string, recipientId: string, status: IntroRequest["status"]): IntroRequest => ({
  id: `${requesterId}-${recipientId}`, eventId: "event", requesterId, recipientId, status, message: null, createdAt: new Date(), respondedAt: null,
});

describe("intro request rules", () => {
  it.each([
    [[], null],
    [[intro("a", "b", "pending")], /already asked to meet them/],
    [[intro("a", "b", "declined")], /declined an earlier request/],
    [[intro("b", "a", "pending")], /already asked to meet you/],
    [[intro("b", "a", "accepted")], /already connected/],
    [[intro("b", "a", "declined")], null],
  ] as const)("refuses or allows a request from a given %o", (existing, expected) => {
    const refusal = introRequestRefusal("a", [...existing]);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toMatch(expected);
  });
});

function deps(overrides: { existing?: IntroRequest[]; pending?: number; allowed?: boolean } = {}) {
  const profile = (id: string) => ({ attendeeId: id, name: id, visible: true, profileComplete: true, email: `${id}@example.com` });
  return {
    participants: { hasEventAccess: vi.fn(async () => true), findProfile: vi.fn(async (_e: string, id: string) => profile(id)) },
    intros: {
      findBetween: vi.fn(async () => overrides.existing ?? []),
      countPendingOutgoing: vi.fn(async () => overrides.pending ?? 0),
      create: vi.fn(async () => intro("a", "b", "pending")),
    },
    limiter: { consume: vi.fn(async () => overrides.allowed ?? true) },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = (dependencies: ReturnType<typeof deps>) => requestIntro({ eventId: "event", requesterId: "a", recipientId: "b" }, dependencies as any);

describe("requestIntro abuse controls", () => {
  it("creates a request when nothing blocks it", async () => {
    const d = deps();
    await ask(d);
    expect(d.intros.create).toHaveBeenCalled();
    expect(d.limiter.consume).toHaveBeenCalledWith("intro:event:a", INTRO_LIMITS.perHour, 3600);
  });

  it("refuses a request to yourself", async () => {
    const d = deps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(requestIntro({ eventId: "event", requesterId: "a", recipientId: "a" }, d as any)).rejects.toThrow(/yourself/);
  });

  it("refuses after a decline, with too many pending, or over the hourly limit", async () => {
    await expect(ask(deps({ existing: [intro("a", "b", "declined")] }))).rejects.toThrow(/declined/);
    await expect(ask(deps({ pending: INTRO_LIMITS.pendingOutgoing }))).rejects.toThrow(/waiting for an answer/);
    await expect(ask(deps({ allowed: false }))).rejects.toThrow(/this hour/);
  });
});
