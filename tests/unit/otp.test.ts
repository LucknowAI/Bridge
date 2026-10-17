import { beforeAll, describe, expect, it } from "vitest";
import { generateCode, generateToken, hashSecret, CODE_LENGTH } from "@match-maker/auth";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret-that-is-definitely-long";
  process.env.OTP_PEPPER = "test-pepper-value";
});

describe("generateCode", () => {
  it("always produces exactly 6 digits", () => {
    for (let i = 0; i < 2000; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });

  it("can produce leading-zero codes", () => {
    // Zero-padding is easy to get wrong and would silently shorten codes.
    const codes = Array.from({ length: 20000 }, generateCode);
    expect(codes.some((c) => c.startsWith("0"))).toBe(true);
    expect(codes.every((c) => c.length === CODE_LENGTH)).toBe(true);
  });

  it("spreads across the full range", () => {
    const codes = new Set(Array.from({ length: 5000 }, generateCode));
    // Collisions are expected at this sample size, but a stuck generator would
    // collapse the set to a handful of values.
    expect(codes.size).toBeGreaterThan(4000);
  });
});

describe("generateToken", () => {
  it("is url-safe and long", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(42);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateToken));
    expect(tokens.size).toBe(1000);
  });
});

describe("hashSecret", () => {
  it("is deterministic", () => {
    expect(hashSecret("123456")).toBe(hashSecret("123456"));
  });

  it("never returns the plaintext", () => {
    expect(hashSecret("123456")).not.toContain("123456");
    expect(hashSecret("123456")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("separates different inputs", () => {
    expect(hashSecret("123456")).not.toBe(hashSecret("123457"));
  });

  it("changes when the pepper changes", () => {
    const before = hashSecret("123456");
    process.env.OTP_PEPPER = "a-different-pepper";
    const after = hashSecret("123456");
    process.env.OTP_PEPPER = "test-pepper-value";
    expect(after).not.toBe(before);
  });
});
