import { afterEach, describe, expect, it, vi } from "vitest";
import { isGoogleSignInEnabled } from "@match-maker/auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google sign-in availability", () => {
  it.each(["", "   ", "not-configured"])("is off without a real Google client id: %j", (clientId) => {
    vi.stubEnv("GOOGLE_CLIENT_ID", clientId);
    expect(isGoogleSignInEnabled()).toBe(false);
  });

  it("is on once a Google client id is configured", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "1234.apps.googleusercontent.com");
    expect(isGoogleSignInEnabled()).toBe(true);
  });
});
