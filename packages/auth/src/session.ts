import { EncryptJWT, jwtDecrypt, base64url } from "jose";
import { createHash } from "node:crypto";
import { getSessionConfig } from "./config";

/**
 * The application session.
 *
 * Both login paths (Google via Keycloak, and e-mail code / magic link) converge
 * on this single shape, so the rest of the app never branches on how the user
 * signed in.
 */
export interface Session {
  /** Keycloak `sub` claim — the stable user id. */
  sub: string;
  email: string;
  name: string | null;
  /** `registered_attendees.id` for the matching roster row. */
  attendeeId: string;
  method: "google" | "email";
  /** Issued-at, epoch seconds. */
  iat: number;
}

const ISSUER = "match-maker";
const AUDIENCE = "match-maker-web";

/**
 * Derive a 256-bit content-encryption key from the configured secret.
 * SESSION_SECRET is an arbitrary-length string, but A256GCM needs exactly 32
 * bytes — SHA-256 gives a deterministic mapping without requiring the operator
 * to supply base64 of an exact length.
 */
function deriveKey(secret: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(secret).digest());
}

/** Decrypts with the current secret, then with each previous one (rotation). */
async function decrypt(value: string, options: { issuer: string; audience: string }) {
  const config = getSessionConfig();
  let failure: unknown;
  for (const secret of [config.secret, ...config.previousSecrets]) {
    try {
      return await jwtDecrypt(value, deriveKey(secret), options);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

/** Encrypt a session into a compact JWE suitable for a cookie value. */
export async function sealSession(
  session: Omit<Session, "iat">
): Promise<string> {
  const config = getSessionConfig();
  return new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${config.maxAge}s`)
    .encrypt(deriveKey(config.secret));
}

/** Decrypt and validate a session cookie. Returns null for anything invalid. */
export async function unsealSession(value: string): Promise<Session | null> {
  if (!value) return null;
  try {
    const { payload } = await decrypt(value, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.attendeeId !== "string"
    ) {
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : null,
      attendeeId: payload.attendeeId,
      method: payload.method === "google" ? "google" : "email",
      iat: typeof payload.iat === "number" ? payload.iat : 0,
    };
  } catch {
    // Expired, tampered with, or encrypted under a rotated secret.
    return null;
  }
}

/** Cookie attributes shared by the session and the short-lived OAuth cookie. */
export function sessionCookieOptions(maxAge: number) {
  const config = getSessionConfig();
  return {
    httpOnly: true,
    secure: config.secure,
    // `lax` still sends the cookie on the top-level GET redirect back from
    // Keycloak, which is exactly what the OAuth callback needs.
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/**
 * Transient state carried across the OAuth redirect: the PKCE verifier plus the
 * CSRF `state` and replay-guard `nonce`. Encrypted the same way as the session
 * and given a short TTL, since it is only needed for one round trip.
 */
export interface OAuthState {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Where to send the user after a successful login. */
  returnTo: string;
}

const OAUTH_TTL_SECONDS = 600;

export async function sealOAuthState(state: OAuthState): Promise<string> {
  const config = getSessionConfig();
  return new EncryptJWT({ ...state })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience("match-maker-oauth")
    .setExpirationTime(`${OAUTH_TTL_SECONDS}s`)
    .encrypt(deriveKey(config.secret));
}

export async function unsealOAuthState(
  value: string
): Promise<OAuthState | null> {
  if (!value) return null;
  try {
    const { payload } = await decrypt(value, {
      issuer: ISSUER,
      audience: "match-maker-oauth",
    });
    if (
      typeof payload.state !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.codeVerifier !== "string"
    ) {
      return null;
    }
    return {
      state: payload.state,
      nonce: payload.nonce,
      codeVerifier: payload.codeVerifier,
      returnTo: typeof payload.returnTo === "string" ? payload.returnTo : "/",
    };
  } catch {
    return null;
  }
}

export const OAUTH_COOKIE_NAME = "mb_oauth";
export const OAUTH_COOKIE_MAX_AGE = OAUTH_TTL_SECONDS;

export { base64url };
