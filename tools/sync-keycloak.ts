/**
 * Bring an already-imported Keycloak realm up to date.
 *
 * Keycloak imports realm-export.json only when the realm does not exist yet, so
 * changing KEYCLOAK_CLIENT_SECRET or the Google credentials in .env (or in AWS
 * Secrets Manager) has no effect on a running realm. This applies them through
 * the admin REST API, along with the account-linking flow and the site's login
 * theme. Safe to re-run; run it after the first Keycloak start and after
 * upgrades.
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
  const path = `/identity-provider/instances/${encodeURIComponent(alias)}`;
  const provider = await (await api(path)).json();
  const googleId = env.GOOGLE_CLIENT_ID?.trim();
  const configured = Boolean(googleId && googleId !== "not-configured");
  await ensureLinkingFlow(api, report);
  await api(path, {
    method: "PUT",
    body: JSON.stringify({
      ...provider,
      ...(configured && {
        enabled: true,
        config: { ...provider.config, clientId: googleId, clientSecret: required(env, "GOOGLE_CLIENT_SECRET") },
      }),
      // Google sign-in joins the account an e-mail code already created instead
      // of asking for a password that account never had.
      // The flow has no "review profile" step, so no Keycloak form appears.
      firstBrokerLoginFlowAlias: LINKING_FLOW,
      trustEmail: true,
    }),
  });
  report.push(configured
    ? `identity provider ${alias}: Google client updated and enabled`
    : `identity provider ${alias}: Google credentials skipped, GOOGLE_CLIENT_ID is not set`);
  report.push(`identity provider ${alias}: first sign-in links existing accounts (${LINKING_FLOW})`);

  const themes = await (await adminServerInfo(http, server, token)).themes?.login ?? [];
  if (themes.some((theme: { name: string }) => theme.name === LOGIN_THEME)) {
    const realmRep = await (await api("")).json();
    if (realmRep.loginTheme !== LOGIN_THEME) await api("", { method: "PUT", body: JSON.stringify({ ...realmRep, loginTheme: LOGIN_THEME }) });
    report.push(`login theme: ${LOGIN_THEME}`);
  } else {
    report.push(`login theme: ${LOGIN_THEME} is not installed in this Keycloak, keeping the default`);
  }
  return report;
}

/** First broker login flow that links a verified Google e-mail to the existing user. */
export const LINKING_FLOW = "mr-bridge link existing account";
const LOGIN_THEME = "mr-bridge";

type Api = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Keycloak's default first-login flow asks someone whose account already exists
 * to confirm it with a password, which accounts created by e-mail sign-in never
 * have. This flow creates the user when the e-mail is new and otherwise links
 * to the existing one. Safe because Google only returns verified addresses
 * (trustEmail) and the app also rejects unverified ones.
 */
async function ensureLinkingFlow(api: Api, report: string[]): Promise<void> {
  const flows = await (await api("/authentication/flows")).json() as Array<{ alias: string }>;
  const flowPath = `/authentication/flows/${encodeURIComponent(LINKING_FLOW)}/executions`;
  if (!flows.some((flow) => flow.alias === LINKING_FLOW)) {
    await api("/authentication/flows", {
      method: "POST",
      body: JSON.stringify({
        alias: LINKING_FLOW,
        description: "Create the user if the e-mail is new, otherwise link the existing account. Managed by npm run keycloak:sync.",
        providerId: "basic-flow",
        topLevel: true,
        builtIn: false,
      }),
    });
    report.push(`flow ${LINKING_FLOW}: created`);
  }
  for (const provider of ["idp-create-user-if-unique", "idp-auto-link"]) {
    const executions = await (await api(flowPath)).json() as Array<{ id: string; providerId: string; requirement: string }>;
    let execution = executions.find((item) => item.providerId === provider);
    if (!execution) {
      await api(`${flowPath}/execution`, { method: "POST", body: JSON.stringify({ provider }) });
      execution = (await (await api(flowPath)).json() as typeof executions).find((item) => item.providerId === provider);
    }
    if (execution && execution.requirement !== "ALTERNATIVE") {
      await api(flowPath, { method: "PUT", body: JSON.stringify({ ...execution, requirement: "ALTERNATIVE" }) });
    }
  }
}

async function adminServerInfo(http: typeof fetch, server: string, token: string) {
  const response = await http(`${server}/admin/serverinfo`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`GET /admin/serverinfo failed (${response.status}).`);
  return response.json();
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
