import { describe, expect, it, vi } from "vitest";
import { LINKING_FLOW, syncKeycloak } from "../../tools/sync-keycloak";

const env = {
  KEYCLOAK_ISSUER: "http://localhost:8080/realms/match-maker",
  KEYCLOAK_CLIENT_ID: "match-maker-web",
  KEYCLOAK_CLIENT_SECRET: "new-secret",
  KEYCLOAK_ADMIN: "admin",
  KEYCLOAK_ADMIN_PASSWORD: "admin",
};
const admin = "http://localhost:8080/admin/realms/match-maker";

function fakeKeycloak(currentSecret = "old-secret", loginThemes = ["keycloak.v2"]) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const flows: Array<{ alias: string }> = [];
  const executions: Array<{ id: string; providerId: string; requirement: string }> = [];
  const http = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url.endsWith("/realms/master/protocol/openid-connect/token")) return json({ access_token: "admin-token" });
    if (url.endsWith("/admin/serverinfo")) return json({ themes: { login: loginThemes.map((name) => ({ name })) } });
    if (url.endsWith("/authentication/flows")) {
      if (method === "POST") { flows.push(body); return new Response(null, { status: 201 }); }
      return json(flows);
    }
    if (url.endsWith("/executions/execution")) {
      executions.push({ id: `exec-${executions.length}`, providerId: body.provider, requirement: "DISABLED" });
      return new Response(null, { status: 201 });
    }
    if (url.endsWith("/executions")) {
      if (method === "PUT") { executions.find((item) => item.id === body.id)!.requirement = body.requirement; return new Response(null, { status: 202 }); }
      return json(executions);
    }
    if (method === "PUT") return new Response(null, { status: 204 });
    if (url.includes("/clients?clientId=")) return json([{ id: "client-uuid", clientId: env.KEYCLOAK_CLIENT_ID }]);
    if (url.endsWith("/client-secret")) return json({ value: currentSecret });
    if (url.endsWith("/identity-provider/instances/google")) return json({ alias: "google", enabled: false, firstBrokerLoginFlowAlias: "first broker login", config: { syncMode: "IMPORT" } });
    if (url === admin) return json({ realm: "match-maker", loginTheme: null });
    return new Response(null, { status: 404 });
  });
  return { http: http as unknown as typeof fetch, calls, flows, executions };
}

const providerPut = (calls: Array<{ method: string; url: string; body?: unknown }>) =>
  calls.find((call) => call.method === "PUT" && call.url.endsWith("/identity-provider/instances/google"));

describe("keycloak:sync", () => {
  it("updates a stale client secret and skips Google credentials when they are not configured", async () => {
    const { http, calls } = fakeKeycloak();
    const report = await syncKeycloak(env, http);
    expect(report).toEqual([
      "client match-maker-web: secret updated",
      `flow ${LINKING_FLOW}: created`,
      "identity provider google: Google credentials skipped, GOOGLE_CLIENT_ID is not set",
      `identity provider google: first sign-in links existing accounts (${LINKING_FLOW})`,
      "login theme: mr-bridge is not installed in this Keycloak, keeping the default",
    ]);
    expect(calls.find((call) => call.method === "PUT")).toMatchObject({
      url: `${admin}/clients/client-uuid`,
      body: { id: "client-uuid", secret: "new-secret" },
    });
    expect(providerPut(calls)?.body).toMatchObject({ enabled: false, firstBrokerLoginFlowAlias: LINKING_FLOW, trustEmail: true });
  });

  it("builds a flow that creates new users and links existing ones, and reuses it", async () => {
    const fake = fakeKeycloak("new-secret");
    await syncKeycloak(env, fake.http);
    expect(fake.flows).toEqual([expect.objectContaining({ alias: LINKING_FLOW, providerId: "basic-flow", topLevel: true })]);
    expect(fake.executions.map((item) => `${item.providerId}:${item.requirement}`))
      .toEqual(["idp-create-user-if-unique:ALTERNATIVE", "idp-auto-link:ALTERNATIVE"]);
    const again = await syncKeycloak(env, fake.http);
    expect(again.join("\n")).not.toMatch(/created/);
    expect(fake.flows).toHaveLength(1);
    expect(fake.executions).toHaveLength(2);
  });

  it("selects the site login theme when Keycloak has it", async () => {
    const { http, calls } = fakeKeycloak("new-secret", ["keycloak.v2", "mr-bridge"]);
    expect(await syncKeycloak(env, http)).toContain("login theme: mr-bridge");
    expect(calls.find((call) => call.method === "PUT" && call.url === admin)?.body).toMatchObject({ loginTheme: "mr-bridge" });
  });

  it("leaves a matching client secret alone", async () => {
    const { http, calls } = fakeKeycloak("new-secret");
    expect((await syncKeycloak(env, http))[0]).toBe("client match-maker-web: secret already matches");
    expect(calls.some((call) => call.method === "PUT" && call.url.includes("/clients/"))).toBe(false);
  });

  it("enables the Google provider with the configured credentials", async () => {
    const { http, calls } = fakeKeycloak("new-secret");
    const report = await syncKeycloak({ ...env, GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "gsecret" }, http);
    expect(report).toContain("identity provider google: Google client updated and enabled");
    expect(providerPut(calls)).toMatchObject({
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
