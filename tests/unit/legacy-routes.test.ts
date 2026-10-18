import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), dbCall: vi.fn() }));

vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
// Any database access from a retired route would hit this spy.
vi.mock("@match-maker/db", () => new Proxy({}, { get: () => new Proxy(mocks.dbCall, { get: () => mocks.dbCall }) }));

import { POST as legacyMatch } from "../../apps/web/app/api/match/route.js";
import { GET as legacyDomains } from "../../apps/web/app/api/domains/route.js";

const fetchSpy = vi.spyOn(globalThis, "fetch");

describe.each([
  ["POST /api/match", () => legacyMatch()],
  ["GET /api/domains", () => legacyDomains()],
])("retired %s", (_name, call) => {
  beforeEach(() => vi.clearAllMocks());

  it("still requires a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("answers 410 Gone without reading attendees or calling a model", async () => {
    mocks.getSession.mockResolvedValue({ attendeeId: "attendee", sub: "subject" });
    const response = await call();
    expect(response.status).toBe(410);
    expect((await response.json()).error).toMatch(/retired/);
    expect(mocks.dbCall).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
