import { describe, expect, it, vi } from "vitest";
import { syncKeycloak } from "../../tools/sync-keycloak";

const env = {
  KEYCLOAK_ISSUER: "http://localhost:8080/realms/match-maker",
  KEYCLOAK_CLIENT_ID: "match-maker-web",
  KEYCLOAK_CLIENT_SECRET: "new-secret",
  KEYCLOAK_ADMIN: "admin",
  KEYCLOAK_ADMIN_PASSWORD: "admin",
};
const admin = "http://localhost:8080/admin/realms/match-maker";

function fakeKeycloak(currentSecret = "old-secret") {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const http = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url.endsWith("/realms/master/protocol/openid-connect/token")) return json({ access_token: "admin-token" });
    if (method === "PUT") return new Response(null, { status: 204 });
    if (url.includes("/clients?clientId=")) return json([{ id: "client-uuid", clientId: env.KEYCLOAK_CLIENT_ID }]);
    if (url.endsWith("/client-secret")) return json({ value: currentSecret });
    if (url.endsWith("/identity-provider/instances/google")) return json({ alias: "google", enabled: false, config: { syncMode: "IMPORT" } });
    return new Response(null, { status: 404 });
  });
  return { http: http as unknown as typeof fetch, calls };
}

describe("keycloak:sync", () => {
  it("updates a stale client secret and skips Google when it is not configured", async () => {
    const { http, calls } = fakeKeycloak();
    const report = await syncKeycloak(env, http);
    expect(report).toEqual([
      "client match-maker-web: secret updated",
      "identity provider google: skipped, GOOGLE_CLIENT_ID is not set",
    ]);
    expect(calls.find((call) => call.method === "PUT")).toMatchObject({
      url: `${admin}/clients/client-uuid`,
      body: { id: "client-uuid", secret: "new-secret" },
    });
  });

  it("leaves a matching client secret alone", async () => {
    const { http, calls } = fakeKeycloak("new-secret");
    expect((await syncKeycloak(env, http))[0]).toBe("client match-maker-web: secret already matches");
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("enables the Google provider with the configured credentials", async () => {
    const { http, calls } = fakeKeycloak("new-secret");
    const report = await syncKeycloak({ ...env, GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "gsecret" }, http);
    expect(report[1]).toBe("identity provider google: Google client updated and enabled");
    expect(calls.find((call) => call.method === "PUT")).toMatchObject({
      url: `${admin}/identity-provider/instances/google`,
      body: { enabled: true, config: { syncMode: "IMPORT", clientId: "id.apps.googleusercontent.com", clientSecret: "gsecret" } },
    });
  });

  it("requires the Google secret alongside the Google client id", async () => {
    const { http } = fakeKeycloak("new-secret");
    await expect(syncKeycloak({ ...env, GOOGLE_CLIENT_ID: "id" }, http)).rejects.toThrow("GOOGLE_CLIENT_SECRET is required");
  });

  it("reports a failed admin login clearly", async () => {
    const http = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
    await expect(syncKeycloak(env, http)).rejects.toThrow("Keycloak admin login failed (401)");
  });
});
