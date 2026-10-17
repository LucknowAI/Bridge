/**
 * Auth configuration, read once from the environment.
 *
 * Everything is resolved lazily so that importing this module in a build step
 * (where the runtime secrets are absent) does not throw — only *using* auth
 * requires the values to be present.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export interface AuthConfig {
  /** e.g. http://localhost:8080/realms/match-maker */
  issuer: string;
  /** Issuer URL reachable from *inside* the container network. */
  internalIssuer: string;
  clientId: string;
  clientSecret: string;
  /** Public origin of the app, used to build the OAuth redirect URI. */
  appBaseUrl: string;
  redirectUri: string;
  /** Keycloak alias of the Google identity provider. */
  googleIdpAlias: string;
}

export function getAuthConfig(): AuthConfig {
  const appBaseUrl = optional("APP_BASE_URL", "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  const issuer = required("KEYCLOAK_ISSUER").replace(/\/$/, "");

  return {
    issuer,
    // Browser redirects must use the public issuer, but server-to-server calls
    // (token exchange, JWKS, admin API) go over the container network where the
    // public hostname may not resolve. In local docker-compose these differ.
    internalIssuer: optional("KEYCLOAK_INTERNAL_ISSUER", issuer).replace(/\/$/, ""),
    clientId: required("KEYCLOAK_CLIENT_ID"),
    clientSecret: required("KEYCLOAK_CLIENT_SECRET"),
    appBaseUrl,
    redirectUri: `${appBaseUrl}/auth/callback`,
    googleIdpAlias: optional("KEYCLOAK_GOOGLE_IDP_ALIAS", "google"),
  };
}

/**
 * Google sign-in is offered only when the Google client is configured; the
 * same GOOGLE_CLIENT_ID feeds Keycloak's identity provider.
 */
export function isGoogleSignInEnabled(): boolean {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  return Boolean(clientId && clientId !== "not-configured");
}

export interface SessionConfig {
  secret: string;
  cookieName: string;
  /** Session lifetime in seconds. */
  maxAge: number;
  secure: boolean;
}

export function getSessionConfig(): SessionConfig {
  const secret = required("SESSION_SECRET");
  if (secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 characters. " +
        "Generate one with: openssl rand -base64 48"
    );
  }
  return {
    secret,
    cookieName: optional("SESSION_COOKIE_NAME", "mb_session"),
    maxAge: Number(optional("SESSION_MAX_AGE", String(60 * 60 * 24 * 7))),
    secure: process.env.NODE_ENV === "production",
  };
}

export interface OtpConfig {
  /** How long a code / magic link stays valid, in seconds. */
  ttlSeconds: number;
  /** Max login e-mails per address inside `rateLimitWindowSeconds`. */
  maxPerWindow: number;
  rateLimitWindowSeconds: number;
  /** Extra secret mixed into the code hash. */
  pepper: string;
}

export function getOtpConfig(): OtpConfig {
  return {
    ttlSeconds: Number(optional("OTP_TTL_SECONDS", "600")),
    maxPerWindow: Number(optional("OTP_MAX_PER_WINDOW", "5")),
    rateLimitWindowSeconds: Number(optional("OTP_RATE_WINDOW_SECONDS", "900")),
    // Falls back to the session secret so a fresh install still hashes safely.
    pepper: optional("OTP_PEPPER", required("SESSION_SECRET")),
  };
}
