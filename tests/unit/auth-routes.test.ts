import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findByEmail: vi.fn(), findByPhone: vi.fn(), canReturnToPath: vi.fn(),
  issueChallenge: vi.fn(), sendLoginEmail: vi.fn(), verifyCode: vi.fn(),
  ensureUser: vi.fn(), setSession: vi.fn(), exchangeCodeForTokens: vi.fn(),
  verifyIdToken: vi.fn(), unsealOAuthState: vi.fn(), sealSession: vi.fn(),
  buildAuthorizationUrl: vi.fn(), sealOAuthState: vi.fn(), verifyToken: vi.fn(),
  isGoogleSignInEnabled: vi.fn(),
}));

vi.mock("@match-maker/db", () => ({
  attendees: { findByEmail: mocks.findByEmail, findByPhone: mocks.findByPhone },
}));
vi.mock("@/lib/session", () => ({
  canReturnToPath: mocks.canReturnToPath, clientIp: () => "127.0.0.1", setSession: mocks.setSession,
}));
vi.mock("@match-maker/email", () => ({ sendLoginEmail: mocks.sendLoginEmail }));
// Per-IP limits and the JSON check are covered in request-guards.test.ts.
vi.mock("@/lib/rate-limit", () => ({ limitByIp: async () => null, requireJson: () => null }));
vi.mock("@match-maker/auth", () => ({
  ...mocks,
  CODE_LENGTH: 6,
  RateLimitError: class extends Error {},
  getOtpConfig: () => ({ ttlSeconds: 600 }),
  getSessionConfig: () => ({ cookieName: "mb_session", maxAge: 3600 }),
  sessionCookieOptions: (maxAge: number) => ({ httpOnly: true, sameSite: "lax", path: "/", maxAge }),
  OAUTH_COOKIE_NAME: "mb_oauth", OAUTH_COOKIE_MAX_AGE: 600,
  createPkce: () => ({ codeVerifier: "verifier", codeChallenge: "challenge" }),
  randomUrlSafe: () => "random-state",
}));

import { POST as requestOtp } from "../../apps/web/app/api/auth/otp/request/route.js";
import { POST as verifyOtp } from "../../apps/web/app/api/auth/otp/verify/route.js";
import { GET as startGoogle } from "../../apps/web/app/api/auth/google/start/route.js";
import { GET as callback } from "../../apps/web/app/auth/callback/route.js";

const attendee = { id: "attendee-id", email: "invited@example.com", name: "Invited Attendee" };
const jsonRequest = (body: object) => new Request("http://localhost:3000/api/auth/otp", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const callbackRequest = () => new NextRequest("http://localhost:3000/auth/callback?code=auth-code&state=expected", {
  headers: { cookie: "mb_oauth=sealed-state" },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  mocks.findByEmail.mockResolvedValue(attendee);
  mocks.findByPhone.mockResolvedValue(attendee);
  mocks.canReturnToPath.mockResolvedValue(true);
  mocks.issueChallenge.mockResolvedValue({ code: "123456", token: "magic-token", expiresAt: new Date("2030-01-01") });
  mocks.sendLoginEmail.mockResolvedValue({ delivered: true });
  mocks.verifyCode.mockResolvedValue({ ok: true });
  mocks.ensureUser.mockResolvedValue("kc-user");
  mocks.unsealOAuthState.mockResolvedValue({ state: "expected", nonce: "nonce", codeVerifier: "verifier", returnTo: "/e/demo" });
  mocks.exchangeCodeForTokens.mockResolvedValue({ id_token: "id-token" });
  mocks.verifyIdToken.mockResolvedValue({ sub: "kc-user", email: attendee.email, email_verified: true });
  mocks.sealSession.mockResolvedValue("sealed-session");
  mocks.buildAuthorizationUrl.mockResolvedValue("http://localhost:8080/realms/match-maker/protocol/openid-connect/auth?kc_idp_hint=google");
  mocks.sealOAuthState.mockResolvedValue("sealed-state");
  mocks.isGoogleSignInEnabled.mockReturnValue(true);
});

describe("on-site email and phone login", () => {
  it.each([{ email: attendee.email }, { phone: "9876543210" }])("sends a code without redirecting: %s", async (identifier) => {
    const response = await requestOtp(jsonRequest({ ...identifier, returnTo: "/e/demo" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    const body = await response.json();
    expect(body.registered).toBe(true);
    expect(body.email).not.toBe(attendee.email);
    expect(body.code).toBeUndefined();
    expect(mocks.sendLoginEmail).toHaveBeenCalledWith(attendee.email, expect.objectContaining({ code: "123456" }));
  });

  it("does not send codes for an event the attendee cannot access", async () => {
    mocks.canReturnToPath.mockResolvedValue(false);
    const response = await requestOtp(jsonRequest({ email: attendee.email, returnTo: "/e/private" }));
    expect(await response.json()).toEqual({ registered: false });
    expect(mocks.issueChallenge).not.toHaveBeenCalled();
  });

  it("opens an app session after email code verification without redirecting", async () => {
    const response = await verifyOtp(jsonRequest({ email: attendee.email, code: "123456", returnTo: "/e/demo" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.ensureUser).toHaveBeenCalledWith(attendee.email, attendee.name);
    expect(mocks.setSession).toHaveBeenCalledWith(expect.objectContaining({ sub: "kc-user", attendeeId: attendee.id, method: "email" }));
  });
});

describe("Google sign-in", () => {
  it("starts Google directly without asking for an email first", async () => {
    const response = await startGoogle(new NextRequest("http://localhost:3000/api/auth/google/start?returnTo=%2Fe%2Fdemo"));
    expect(response.headers.get("location")).toContain("kc_idp_hint=google");
    expect(response.cookies.get("mb_oauth")?.value).toBe("sealed-state");
    expect(mocks.buildAuthorizationUrl).toHaveBeenCalledWith(expect.objectContaining({ useGoogleIdp: true }));
    expect(mocks.sealOAuthState).toHaveBeenCalledWith(expect.objectContaining({ returnTo: "/e/demo" }));
  });

  it("refuses to start Google when it is not configured", async () => {
    mocks.isGoogleSignInEnabled.mockReturnValue(false);
    const response = await startGoogle(new NextRequest("http://localhost:3000/api/auth/google/start?returnTo=%2Fe%2Fdemo"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=google_unavailable&returnTo=%2Fe%2Fdemo");
    expect(mocks.buildAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("returns a verified invited account to its event with a session", async () => {
    const response = await callback(callbackRequest());
    expect(response.headers.get("location")).toBe("http://localhost:3000/e/demo");
    expect(response.cookies.get("mb_session")?.value).toBe("sealed-session");
    expect(response.cookies.get("mb_oauth")?.value).toBe("");
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("id-token", "nonce");
  });

  it("rejects an unverified email even when it matches the roster", async () => {
    mocks.verifyIdToken.mockResolvedValue({ sub: "kc-user", email: attendee.email, email_verified: false });
    const response = await callback(callbackRequest());
    expect(response.headers.get("location")).toContain("error=email_unverified");
    expect(mocks.sealSession).not.toHaveBeenCalled();
    expect(response.cookies.get("mb_oauth")?.value).toBe("");
  });

  it("rejects a valid Google account missing from the invited roster", async () => {
    mocks.findByEmail.mockResolvedValue(null);
    const response = await callback(callbackRequest());
    expect(response.headers.get("location")).toContain("error=unregistered");
    expect(mocks.sealSession).not.toHaveBeenCalled();
  });

  it("checks the event membership again after Google authenticates", async () => {
    mocks.canReturnToPath.mockResolvedValue(false);
    const response = await callback(callbackRequest());
    expect(response.headers.get("location")).toContain("error=unregistered");
    expect(mocks.sealSession).not.toHaveBeenCalled();
  });

  it("rejects mismatched OAuth state before exchanging the code", async () => {
    mocks.unsealOAuthState.mockResolvedValue({ state: "different-state" });
    const response = await callback(callbackRequest());
    expect(response.headers.get("location")).toContain("error=state_mismatch");
    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled();
  });
});

describe("failed sign-in keeps the event destination", () => {
  it("returns a cancelled Google consent to login for the same event", async () => {
    const response = await callback(new NextRequest("http://localhost:3000/auth/callback?error=access_denied", {
      headers: { cookie: "mb_oauth=sealed-state" },
    }));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=provider&returnTo=%2Fe%2Fdemo");
    expect(response.cookies.get("mb_oauth")?.value).toBe("");
  });

  it("keeps the destination when the roster rejects a Google account", async () => {
    mocks.findByEmail.mockResolvedValue(null);
    const response = await callback(callbackRequest());
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=unregistered&returnTo=%2Fe%2Fdemo");
  });

  it("keeps the destination when token exchange fails", async () => {
    mocks.exchangeCodeForTokens.mockRejectedValue(new Error("keycloak down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await callback(callbackRequest());
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=verification_failed&returnTo=%2Fe%2Fdemo");
  });

  it("keeps the magic link destination when the link has expired", async () => {
    mocks.verifyToken.mockResolvedValue({ ok: false, reason: "expired" });
    const response = await callback(new NextRequest("http://localhost:3000/auth/callback?token=old&returnTo=%2Fe%2Fdemo%2Fprofile"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=expired&returnTo=%2Fe%2Fdemo%2Fprofile");
  });

  it("keeps the destination when Google start rejects an uninvited email", async () => {
    mocks.findByEmail.mockResolvedValue(null);
    const response = await startGoogle(new NextRequest("http://localhost:3000/api/auth/google/start?email=x%40example.com&returnTo=%2Fe%2Fdemo"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=unregistered&returnTo=%2Fe%2Fdemo");
  });
});
