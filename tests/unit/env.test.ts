import { describe, expect, it } from "vitest";
import { assertEnv, checkEnv } from "@/src/lib/env";

const validWeb = {
  DATABASE_URL: "postgres://matchmaker:matchmaker@localhost:5432/matchmaker",
  SESSION_SECRET: "x".repeat(32),
  KEYCLOAK_ISSUER: "http://localhost:8080/realms/match-maker",
  KEYCLOAK_CLIENT_ID: "match-maker-web",
  KEYCLOAK_CLIENT_SECRET: "secret",
};

describe("checkEnv", () => {
  it("accepts a complete web configuration", () => {
    expect(checkEnv("web", validWeb)).toEqual([]);
  });

  it("lists every missing web setting at once", () => {
    const problems = checkEnv("web", {});
    expect(problems).toHaveLength(5);
    expect(problems.join("\n")).toContain("SESSION_SECRET is required");
    expect(problems.join("\n")).toContain("KEYCLOAK_CLIENT_SECRET is required");
  });

  it("only requires the database for the worker", () => {
    expect(checkEnv("worker", { DATABASE_URL: validWeb.DATABASE_URL })).toEqual([]);
    expect(checkEnv("worker", {})).toEqual(["DATABASE_URL is required but not set."]);
  });

  it("treats blank values as missing", () => {
    expect(checkEnv("worker", { DATABASE_URL: "   " })).toEqual(["DATABASE_URL is required but not set."]);
  });

  it("rejects a short session secret", () => {
    expect(checkEnv("web", { ...validWeb, SESSION_SECRET: "short" })).toEqual([
      "SESSION_SECRET must be at least 32 characters.",
    ]);
  });

  it("rejects malformed URLs, numbers, and enum values", () => {
    const problems = checkEnv("web", {
      ...validWeb,
      APP_BASE_URL: "localhost:3000",
      DATABASE_POOL_MAX: "ten",
      DATABASE_SSL: "on",
    });
    expect(problems).toEqual([
      'APP_BASE_URL must be an http(s) URL, got "localhost:3000".',
      'DATABASE_POOL_MAX must be a positive integer, got "ten".',
      'DATABASE_SSL must be one of disable, require, got "on".',
    ]);
  });

  it("rejects a non-postgres database URL", () => {
    expect(checkEnv("worker", { DATABASE_URL: "mysql://localhost/db" })).toEqual([
      "DATABASE_URL must start with postgres:// or postgresql://.",
    ]);
  });

  it("requires a local embedding endpoint when the local provider is selected", () => {
    expect(checkEnv("worker", { ...validWeb, EMBEDDING_PROVIDER: "local" })).toEqual([
      "LOCAL_BGE_URL is required when EMBEDDING_PROVIDER=local.",
    ]);
  });

  it("requires both Upstash settings together", () => {
    expect(checkEnv("worker", { ...validWeb, UPSTASH_REDIS_REST_URL: "https://x.upstash.io" })).toEqual([
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together.",
    ]);
  });
});

describe("assertEnv", () => {
  it("throws one error naming every problem", () => {
    expect(() => assertEnv("web", {})).toThrowError(/Invalid web configuration:[\s\S]*DATABASE_URL[\s\S]*SESSION_SECRET/);
  });

  it("does not throw for a valid configuration", () => {
    expect(() => assertEnv("web", validWeb)).not.toThrow();
  });
});
