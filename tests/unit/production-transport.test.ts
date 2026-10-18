import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEnv } from "@/src/lib/env";
import { isLocalDatabase, resolveSsl } from "../../packages/db/src/client";

const REMOTE = "postgres://app:pw@db.abc.ap-south-1.rds.amazonaws.com:5432/match_maker";
const LOCAL = "postgres://matchmaker:matchmaker@postgres:5432/matchmaker";
const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

describe("resolveSsl", () => {
  it("leaves local databases unencrypted unless asked", () => {
    expect(isLocalDatabase(LOCAL)).toBe(true);
    expect(resolveSsl(LOCAL, {})).toBe(false);
    expect(resolveSsl(LOCAL, { DATABASE_SSL: "require" })).toEqual({ rejectUnauthorized: false });
  });

  it("verifies the certificate in verify mode, from inline PEM or a file", () => {
    expect(resolveSsl(REMOTE, { DATABASE_SSL: "verify", DATABASE_CA_CERT: CA })).toEqual({ ca: CA, rejectUnauthorized: true });
    const file = join(mkdtempSync(join(tmpdir(), "ca-")), "bundle.pem");
    writeFileSync(file, CA);
    expect(resolveSsl(REMOTE, { DATABASE_SSL: "verify", DATABASE_CA_CERT_FILE: file })).toEqual({ ca: CA, rejectUnauthorized: true });
  });

  it("refuses verify mode without a CA instead of silently skipping the check", () => {
    expect(() => resolveSsl(REMOTE, { DATABASE_SSL: "verify" })).toThrow(/DATABASE_CA_CERT/);
  });

  it("does not treat a hostname merely containing 'postgres' as local", () => {
    expect(isLocalDatabase("postgres://u:p@postgres.example.com/db")).toBe(false);
  });
});

describe("production startup checks", () => {
  const web = {
    NODE_ENV: "production",
    DATABASE_URL: REMOTE,
    DATABASE_SSL: "verify",
    DATABASE_CA_CERT_FILE: "/etc/ssl/certs/rds-global-bundle.pem",
    SESSION_SECRET: "x".repeat(32),
    KEYCLOAK_ISSUER: "https://bridge.example.com/realms/match-maker",
    KEYCLOAK_CLIENT_ID: "match-maker-web",
    KEYCLOAK_CLIENT_SECRET: "secret",
    RESEND_API_KEY: "re_key",
    EMAIL_FROM: "Bridge <login@example.com>",
    APP_BASE_URL: "https://bridge.example.com",
  };

  it("accepts verified TLS and an https base URL", () => {
    expect(checkEnv("web", web)).toEqual([]);
  });

  it.each([
    [{ DATABASE_SSL: "require" }, /DATABASE_SSL must be verify/],
    [{ DATABASE_SSL: undefined }, /DATABASE_SSL must be verify/],
    [{ DATABASE_CA_CERT_FILE: undefined }, /needs DATABASE_CA_CERT/],
    [{ APP_BASE_URL: "http://bridge.example.com" }, /must use https/],
    [{ APP_BASE_URL: undefined }, /APP_BASE_URL is required/],
  ])("refuses %o", (change, message) => {
    expect(checkEnv("web", { ...web, ...change }).join("\n")).toMatch(message);
  });

  it("applies the database rule to the worker too", () => {
    expect(checkEnv("worker", { NODE_ENV: "production", DATABASE_URL: REMOTE, DATABASE_SSL: "require" }).join("\n"))
      .toMatch(/DATABASE_SSL must be verify/);
  });

  it("still lets the local docker-compose stack run as production", () => {
    const local = { ...web, DATABASE_URL: LOCAL, DATABASE_SSL: "disable", APP_BASE_URL: "http://localhost:3000" };
    expect(checkEnv("web", local)).toEqual([]);
  });
});
