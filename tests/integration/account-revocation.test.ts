/**
 * Account disable, enable and "sign out everywhere" against the real database
 * and the real Keycloak realm. Creates its own attendee and Keycloak user and
 * deletes both afterwards. Skipped unless DATABASE_URL and a reachable
 * Keycloak (KEYCLOAK_ISSUER plus admin credentials) are configured.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendees, closePool, query } from "@match-maker/db";
import { ensureUser, isSessionActive, isUserEnabled, resetCaches } from "@match-maker/auth";
import { migrate } from "../../packages/db/src/migrate";
import { manageAccount } from "../../tools/manage-account";

const issuer = (process.env.KEYCLOAK_INTERNAL_ISSUER || process.env.KEYCLOAK_ISSUER || "").replace(/\/$/, "");
const reachable = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3000) })
  .then((res) => res.ok).catch(() => false);
const describeLive = process.env.DATABASE_URL && process.env.KEYCLOAK_ADMIN_PASSWORD && reachable ? describe : describe.skip;

const EMAIL = `revocation-${Date.now().toString(36)}@example.com`;

async function deleteKeycloakUser(sub: string) {
  const [, server, realm] = issuer.match(/^(.*)\/realms\/([^/]+)$/)!;
  const token = await fetch(`${server}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: process.env.KEYCLOAK_ADMIN!, password: process.env.KEYCLOAK_ADMIN_PASSWORD! }),
  }).then((res) => res.json());
  await fetch(`${server}/admin/realms/${realm}/users/${sub}`, { method: "DELETE", headers: { Authorization: `Bearer ${token.access_token}` } });
}

describeLive("account disable and session revocation", () => {
  let sub: string;
  let attendeeId: string;
  const session = () => ({ sub, email: EMAIL, name: "Revocation Test", attendeeId, method: "email" as const, iat: Math.floor(Date.now() / 1000) - 5 });

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany([{ name: "Revocation Test", email: EMAIL }]);
    attendeeId = (await attendees.findByEmail(EMAIL))!.id;
    sub = await ensureUser(EMAIL, "Revocation Test");
  });

  afterAll(async () => {
    if (sub) await deleteKeycloakUser(sub);
    await query(`delete from registered_attendees where email = $1`, [EMAIL]);
    await closePool();
  });

  it("keeps one Keycloak identity for repeated sign-ins", async () => {
    expect(await ensureUser(EMAIL, "Revocation Test")).toBe(sub);
    await expect(isSessionActive(session())).resolves.toBe(true);
  });

  it("disables the account in the database and in Keycloak", async () => {
    const existing = session();
    const report = await manageAccount("disable", EMAIL);
    expect(report.join("\n")).toMatch(/keycloak: user disabled/);
    resetCaches();
    await expect(isUserEnabled(sub)).resolves.toBe(false);
    await expect(isSessionActive(existing)).resolves.toBe(false);
  });

  it("enables it again, without reviving sessions from before the disable", async () => {
    const beforeDisable = { ...session(), iat: Math.floor(Date.now() / 1000) - 3600 };
    await manageAccount("enable", EMAIL);
    resetCaches();
    await expect(isUserEnabled(sub)).resolves.toBe(true);
    await expect(isSessionActive(beforeDisable)).resolves.toBe(false);
    await expect(isSessionActive({ ...session(), iat: Math.floor(Date.now() / 1000) + 1 })).resolves.toBe(true);
  });

  it("signs out everywhere without disabling", async () => {
    const existing = session();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await manageAccount("revoke-sessions", EMAIL);
    await expect(isSessionActive(existing)).resolves.toBe(false);
    expect((await attendees.accountState(attendeeId))!.disabled_at).toBeNull();
  });
});
