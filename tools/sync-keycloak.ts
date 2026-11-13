/**
 * Push credentials from the environment into an already-imported Keycloak realm.
 *
 * Keycloak imports realm-export.json only when the realm does not exist yet, so
 * changing KEYCLOAK_CLIENT_SECRET or the Google credentials in .env (or in AWS
 * Secrets Manager) has no effect on a running realm. This applies them through
 * the admin REST API. Safe to re-run.
 *
 * Run with:  npm run keycloak:sync
 */
import { isMainModule } from "../packages/db/src/is-main";

type Env = Record<string, string | undefined>;

export async function syncKeycloak(env: Env = process.env, http: typeof fetch = fetch): Promise<string[]> {
  const issuer = (env.KEYCLOAK_INTERNAL_ISSUER || env.KEYCLOAK_ISSUER || "").replace(/\/$/, "");
  const match = issuer.match(/^(https?:\/\/.+)\/realms\/([^/]+)$/);
  if (!match) throw new Error("KEYCLOAK_ISSUER must look like http://host:port/realms/<realm>.");
  const [, server, realm] = match;
  const clientId = required(env, "KEYCLOAK_CLIENT_ID");
  const clientSecret = required(env, "KEYCLOAK_CLIENT_SECRET");

  const token = await adminToken(http, server, required(env, "KEYCLOAK_ADMIN"), required(env, "KEYCLOAK_ADMIN_PASSWORD"));
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await http(`${server}/admin/realms/${realm}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}).`);
    return response;
  };

  const report: string[] = [];
  const [client] = await (await api(`/clients?clientId=${encodeURIComponent(clientId)}`)).json();
  if (!client) throw new Error(`Client "${clientId}" does not exist in realm "${realm}".`);
  const current = await (await api(`/clients/${client.id}/client-secret`)).json();
  if (current.value === clientSecret) {
    report.push(`client ${clientId}: secret already matches`);
  } else {
    await api(`/clients/${client.id}`, { method: "PUT", body: JSON.stringify({ ...client, secret: clientSecret }) });
    report.push(`client ${clientId}: secret updated`);
  }

  const alias = env.KEYCLOAK_GOOGLE_IDP_ALIAS || "google";
  const googleId = env.GOOGLE_CLIENT_ID?.trim();
  if (!googleId || googleId === "not-configured") {
    report.push(`identity provider ${alias}: skipped, GOOGLE_CLIENT_ID is not set`);
    return report;
  }
  const googleSecret = required(env, "GOOGLE_CLIENT_SECRET");
  const path = `/identity-provider/instances/${encodeURIComponent(alias)}`;
  const provider = await (await api(path)).json();
  await api(path, {
    method: "PUT",
    body: JSON.stringify({
      ...provider,
      enabled: true,
      config: { ...provider.config, clientId: googleId, clientSecret: googleSecret },
    }),
  });
  report.push(`identity provider ${alias}: Google client updated and enabled`);
  return report;
}

async function adminToken(http: typeof fetch, server: string, username: string, password: string): Promise<string> {
  const response = await http(`${server}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username, password }),
  });
  if (!response.ok) throw new Error(`Keycloak admin login failed (${response.status}). Check KEYCLOAK_ADMIN and KEYCLOAK_ADMIN_PASSWORD.`);
  return (await response.json()).access_token;
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required. See .env.example.`);
  return value;
}

if (isMainModule(import.meta.url)) {
  await import("dotenv/config");
  try {
    for (const line of await syncKeycloak()) console.info(`[keycloak:sync] ${line}`);
  } catch (error) {
    console.error(`[keycloak:sync] ${(error as Error).message}`);
    process.exit(1);
  }
}
