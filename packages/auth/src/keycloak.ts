import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getAuthConfig } from "./config";

/** Subset of the OIDC discovery document this app uses. */
interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint: string;
  userinfo_endpoint: string;
}

let discoveryCache: { value: Discovery; fetchedAt: number } | null = null;
const DISCOVERY_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch (and cache) the realm's OIDC metadata, then rewrite each endpoint for
 * the party that will actually call it.
 *
 * Keycloak advertises every endpoint using the hostname it was *configured*
 * with (KC_HOSTNAME), no matter which address the document was fetched from.
 * In docker-compose that is the browser-facing `localhost:8080`, which the app
 * container cannot reach — so server-to-server endpoints are mapped onto the
 * internal host, while the two endpoints the browser is redirected to are
 * forced back to the public one.
 */
export async function discover(): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.fetchedAt < DISCOVERY_TTL_MS) {
    return discoveryCache.value;
  }

  const config = getAuthConfig();
  const url = `${config.internalIssuer}/.well-known/openid-configuration`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(
      `Keycloak discovery failed (${res.status}) at ${url}. Is Keycloak running?`
    );
  }

  const raw = (await res.json()) as Discovery;

  // Both directions are applied so the mapping holds whichever hostname
  // Keycloak happens to be configured with.
  const toPublic = (endpoint: string) =>
    endpoint.replace(config.internalIssuer, config.issuer);
  const toInternal = (endpoint: string) =>
    endpoint.replace(config.issuer, config.internalIssuer);

  const value: Discovery = {
    // The browser is redirected to these two.
    authorization_endpoint: toPublic(raw.authorization_endpoint),
    end_session_endpoint: toPublic(raw.end_session_endpoint),
    // These are called from this process, over the container network.
    token_endpoint: toInternal(raw.token_endpoint),
    jwks_uri: toInternal(raw.jwks_uri),
    userinfo_endpoint: toInternal(raw.userinfo_endpoint),
  };

  discoveryCache = { value, fetchedAt: Date.now() };
  return value;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export interface Pkce {
  codeVerifier: string;
  codeChallenge: string;
}

export function createPkce(): Pkce {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(
    createHash("sha256").update(codeVerifier).digest()
  );
  return { codeVerifier, codeChallenge };
}

export function randomUrlSafe(bytes = 32): string {
  return base64UrlEncode(randomBytes(bytes));
}

export interface AuthorizationUrlInput {
  state: string;
  nonce: string;
  codeChallenge: string;
  /** Pre-fill the Google account chooser with this address. */
  loginHint?: string;
  /**
   * When true, jump straight to Google instead of rendering Keycloak's own
   * login page. This is what keeps the existing UI intact — the user goes from
   * our page to Google's consent screen and back, never seeing Keycloak.
   */
  useGoogleIdp?: boolean;
}

export async function buildAuthorizationUrl(
  input: AuthorizationUrlInput
): Promise<string> {
  const config = getAuthConfig();
  const { authorization_endpoint } = await discover();

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });

  if (input.useGoogleIdp) params.set("kc_idp_hint", config.googleIdpAlias);
  if (input.loginHint) params.set("login_hint", input.loginHint);

  return `${authorization_endpoint}?${params.toString()}`;
}

export interface TokenSet {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<TokenSet> {
  const config = getAuthConfig();
  const { token_endpoint } = await discover();

  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${detail}`);
  }

  return (await res.json()) as TokenSet;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUri: string | null = null;

async function getJwks() {
  const { jwks_uri } = await discover();
  // Rebuild only when the URI itself changes; the set caches and rotates keys.
  if (!jwks || jwksUri !== jwks_uri) {
    jwks = createRemoteJWKSet(new URL(jwks_uri));
    jwksUri = jwks_uri;
  }
  return jwks;
}

export interface IdTokenClaims extends JWTPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
}

/**
 * Verify an ID token's signature, issuer, audience and nonce.
 *
 * The nonce check is what binds the token to *this* browser's login attempt —
 * without it a token obtained elsewhere could be replayed into our callback.
 */
export async function verifyIdToken(
  idToken: string,
  expectedNonce: string
): Promise<IdTokenClaims> {
  const config = getAuthConfig();
  const keySet = await getJwks();

  const { payload } = await jwtVerify(idToken, keySet, {
    issuer: config.issuer,
    audience: config.clientId,
    clockTolerance: 5,
  });

  if (payload.nonce !== expectedNonce) {
    throw new Error("ID token nonce mismatch");
  }
  if (typeof payload.sub !== "string") {
    throw new Error("ID token is missing the sub claim");
  }

  return payload as IdTokenClaims;
}

export async function buildLogoutUrl(redirectTo: string): Promise<string> {
  const config = getAuthConfig();
  const { end_session_endpoint } = await discover();
  const params = new URLSearchParams({
    client_id: config.clientId,
    post_logout_redirect_uri: redirectTo,
  });
  return `${end_session_endpoint}?${params.toString()}`;
}

// ── Admin API ────────────────────────────────────────────────────────────────
// Used by the e-mail login path. That path proves ownership of the address by
// itself (the code/link only reaches the real inbox), but the user still needs
// a Keycloak identity so both login methods produce the same `sub` for the same
// person. The web client's service account holds `manage-users` on the realm.

let adminToken: { value: string; expiresAt: number } | null = null;

async function getAdminToken(): Promise<string> {
  if (adminToken && Date.now() < adminToken.expiresAt) return adminToken.value;

  const config = getAuthConfig();
  const { token_endpoint } = await discover();

  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `Keycloak service-account login failed (${res.status}): ${detail}. ` +
        `Ensure the client has "Service accounts roles" enabled.`
    );
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  adminToken = {
    value: json.access_token,
    // Refresh 30s early so a request never races the expiry.
    expiresAt: Date.now() + (json.expires_in - 30) * 1000,
  };
  return adminToken.value;
}

/** Base URL of the realm's admin REST API. */
function adminBase(): string {
  const config = getAuthConfig();
  // internalIssuer looks like http://host/realms/<realm>
  const match = config.internalIssuer.match(/^(.*)\/realms\/([^/]+)$/);
  if (!match) {
    throw new Error(
      `KEYCLOAK_ISSUER must end in /realms/<realm>, got: ${config.internalIssuer}`
    );
  }
  return `${match[1]}/admin/realms/${match[2]}`;
}

interface KeycloakUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAdminToken();
  return fetch(`${adminBase()}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
}

export async function findUserByEmail(
  email: string
): Promise<KeycloakUser | null> {
  const res = await adminFetch(
    `/users?email=${encodeURIComponent(email)}&exact=true`
  );
  if (!res.ok) {
    throw new Error(`Keycloak user lookup failed (${res.status})`);
  }
  const users = (await res.json()) as KeycloakUser[];
  return users[0] ?? null;
}

/**
 * Return the Keycloak `sub` for an e-mail, creating the user if absent.
 *
 * The account is created already-verified and without credentials: the only way
 * to reach this function is by proving inbox ownership, and no password login
 * exists for it.
 */
export async function ensureUser(
  email: string,
  name: string | null
): Promise<string> {
  const existing = await findUserByEmail(email);
  if (existing) return existing.id;

  const [firstName, ...rest] = (name ?? "").trim().split(/\s+/);

  const res = await adminFetch("/users", {
    method: "POST",
    body: JSON.stringify({
      username: email,
      email,
      emailVerified: true,
      enabled: true,
      firstName: firstName || undefined,
      lastName: rest.length ? rest.join(" ") : undefined,
    }),
  });

  if (res.status === 409) {
    // Created concurrently by another request — re-read and use that one.
    const raced = await findUserByEmail(email);
    if (raced) return raced.id;
  }

  if (!res.ok && res.status !== 409) {
    const detail = await res.text();
    throw new Error(`Keycloak user creation failed (${res.status}): ${detail}`);
  }

  // Keycloak returns the new id in the Location header rather than the body.
  const location = res.headers.get("location");
  const id = location?.split("/").pop();
  if (id) return id;

  const created = await findUserByEmail(email);
  if (!created) throw new Error("Keycloak user was created but cannot be found");
  return created.id;
}

/** Clear cached discovery/tokens. Exposed for tests. */
export function resetCaches(): void {
  discoveryCache = null;
  adminToken = null;
  jwks = null;
  jwksUri = null;
}
