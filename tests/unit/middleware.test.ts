import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const unsealSession = vi.hoisted(() => vi.fn());

vi.mock("@match-maker/auth", () => ({
  unsealSession,
  getSessionConfig: () => ({ cookieName: "mb_session" }),
  sessionCookieOptions: (maxAge: number) => ({ httpOnly: true, sameSite: "lax", path: "/", maxAge }),
}));

import { middleware } from "../../apps/web/middleware";

const session = { sub: "kc-user", email: "invited@example.com", name: null, attendeeId: "attendee-id", method: "email", iat: 0 };
const loginRequest = (query = "", cookie?: string) =>
  new NextRequest(`http://localhost:3000/login${query}`, cookie ? { headers: { cookie } } : undefined);

beforeEach(() => {
  unsealSession.mockReset();
});

describe("login middleware", () => {
  it("shows the form when there is no session cookie", async () => {
    const response = await middleware(loginRequest("?returnTo=%2Fe%2Fdemo"));
    expect(response.headers.get("location")).toBeNull();
    expect(unsealSession).not.toHaveBeenCalled();
  });

  it("sends a valid session to its requested destination", async () => {
    unsealSession.mockResolvedValue(session);
    const response = await middleware(loginRequest("?returnTo=%2Forgs%2Fai%2Fevents%2Fdemo", "mb_session=valid"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/orgs/ai/events/demo");
  });

  it("sends a valid session without a destination to the home route", async () => {
    unsealSession.mockResolvedValue(session);
    const response = await middleware(loginRequest("", "mb_session=valid"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it.each(["/login", "/login?returnTo=%2Flogin", "https://outside.example"])(
    "never redirects a valid session back to login or off-site: %s",
    async (returnTo) => {
      unsealSession.mockResolvedValue(session);
      const response = await middleware(loginRequest(`?returnTo=${encodeURIComponent(returnTo)}`, "mb_session=valid"));
      expect(response.headers.get("location")).toBe("http://localhost:3000/");
    }
  );

  it("keeps a valid session on the form when a sign-in error is shown", async () => {
    unsealSession.mockResolvedValue(session);
    const response = await middleware(loginRequest("?error=unregistered&returnTo=%2Fe%2Fother", "mb_session=valid"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("mb_session")).toBeUndefined();
  });

  it("clears an expired or tampered cookie and shows the form", async () => {
    unsealSession.mockResolvedValue(null);
    const response = await middleware(loginRequest("?returnTo=%2Fe%2Fdemo%2Fprofile", "mb_session=expired"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("mb_session")).toMatchObject({ value: "", maxAge: 0 });
  });
});
