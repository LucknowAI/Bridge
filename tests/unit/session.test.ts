import { beforeAll, describe, expect, it } from "vitest";
import {
  sealSession,
  unsealSession,
  sealOAuthState,
  unsealOAuthState,
} from "@match-maker/auth";

const SECRET = "test-session-secret-that-is-definitely-long-enough";

beforeAll(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe("session cookie", () => {
  const session = {
    sub: "kc-subject-123",
    email: "aarav@example.com",
    name: "Aarav Sharma",
    attendeeId: "11111111-2222-3333-4444-555555555555",
    method: "email" as const,
  };

  it("round-trips a sealed session", async () => {
    const restored = await unsealSession(await sealSession(session));
    expect(restored).toMatchObject(session);
  });

  it("produces an opaque token that does not leak the payload", async () => {
    const sealed = await sealSession(session);
    expect(sealed).not.toContain("aarav@example.com");
    expect(sealed).not.toContain("kc-subject-123");
  });

  it("rejects a session sealed with a different secret", async () => {
    const sealed = await sealSession(session);
    process.env.SESSION_SECRET = "a-completely-different-secret-value-here!!";
    expect(await unsealSession(sealed)).toBeNull();
    process.env.SESSION_SECRET = SECRET;
  });

  it("keeps sessions sealed before a rotation, while new ones use the new secret", async () => {
    const before = await sealSession(session);
    const rotated = "the-new-session-secret-after-rotation-123456";
    process.env.SESSION_SECRET = rotated;
    process.env.SESSION_SECRET_PREVIOUS = SECRET;
    try {
      expect(await unsealSession(before)).toMatchObject(session);
      const after = await sealSession(session);
      // Once the old secret is dropped, only cookies sealed after the rotation still work.
      delete process.env.SESSION_SECRET_PREVIOUS;
      expect(await unsealSession(after)).toMatchObject(session);
      expect(await unsealSession(before)).toBeNull();
    } finally {
      process.env.SESSION_SECRET = SECRET;
      delete process.env.SESSION_SECRET_PREVIOUS;
    }
  });

  it("refuses a short previous secret", async () => {
    process.env.SESSION_SECRET_PREVIOUS = "too-short";
    try {
      await expect(sealSession(session)).rejects.toThrow(/SESSION_SECRET_PREVIOUS/);
    } finally {
      delete process.env.SESSION_SECRET_PREVIOUS;
    }
  });

  it("rejects a tampered token", async () => {
    const sealed = await sealSession(session);
    const parts = sealed.split(".");
    // Corrupt the ciphertext segment; AEAD must fail the integrity check.
    parts[3] = parts[3]!.slice(0, -4) + "AAAA";
    expect(await unsealSession(parts.join("."))).toBeNull();
  });

  it("rejects empty and malformed values", async () => {
    expect(await unsealSession("")).toBeNull();
    expect(await unsealSession("not-a-jwe")).toBeNull();
  });

  it("does not accept an OAuth-state token as a session", async () => {
    // Different audience — a state cookie must never be usable as a login.
    const state = await sealOAuthState({
      state: "s",
      nonce: "n",
      codeVerifier: "v",
      returnTo: "/",
    });
    expect(await unsealSession(state)).toBeNull();
  });
});

describe("oauth state cookie", () => {
  it("round-trips PKCE state", async () => {
    const value = {
      state: "state-abc",
      nonce: "nonce-def",
      codeVerifier: "verifier-ghi",
      returnTo: "/matches",
    };
    expect(await unsealOAuthState(await sealOAuthState(value))).toMatchObject(value);
  });

  it("does not accept a session token as OAuth state", async () => {
    const sealed = await sealSession({
      sub: "s",
      email: "e@example.com",
      name: null,
      attendeeId: "a",
      method: "google",
    });
    expect(await unsealOAuthState(sealed)).toBeNull();
  });
});
