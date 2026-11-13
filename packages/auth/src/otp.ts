import { createHash, randomInt, randomBytes, timingSafeEqual } from "node:crypto";
import { loginChallenges } from "@match-maker/db";
import { getOtpConfig } from "./config";

export const CODE_LENGTH = 6;

/** Cryptographically uniform 6-digit code, zero-padded. */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** Opaque magic-link token. 32 bytes is well beyond guessable. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash a code or token before storage.
 *
 * The pepper is an application secret that never lives in the database, so a
 * dumped `login_challenges` table cannot be brute-forced offline (a 6-digit
 * code alone would fall in milliseconds).
 */
export function hashSecret(value: string): string {
  const { pepper } = getOtpConfig();
  return createHash("sha256").update(`${value}:${pepper}`).digest("hex");
}

/** Constant-time comparison of two hex digests. */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface IssuedChallenge {
  code: string;
  token: string;
  expiresAt: Date;
}

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many login e-mails requested. Please wait before trying again.");
    this.name = "RateLimitError";
  }
}

/**
 * Create a login challenge and return the *plaintext* code and token for
 * delivery by e-mail. Only their hashes are persisted, so this is the one and
 * only moment either value exists in readable form.
 */
export async function issueChallenge(input: {
  email: string;
  attendeeId: string | null;
  ipAddress: string | null;
}): Promise<IssuedChallenge> {
  const config = getOtpConfig();

  const code = generateCode();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + config.ttlSeconds * 1000);

  const created = await loginChallenges.createWithinLimit({
    email: input.email,
    attendeeId: input.attendeeId,
    codeHash: hashSecret(code),
    tokenHash: hashSecret(token),
    expiresAt,
    ipAddress: input.ipAddress,
  }, { maxPerWindow: config.maxPerWindow, windowSeconds: config.rateLimitWindowSeconds });
  if (!created) throw new RateLimitError(config.rateLimitWindowSeconds);

  return { code, token, expiresAt };
}

export type VerifyFailure =
  | "not_found"
  | "expired"
  | "too_many_attempts"
  | "invalid_code"
  | "already_used";

export type VerifyResult =
  | { ok: true; email: string; attendeeId: string | null }
  | { ok: false; reason: VerifyFailure };

/** Verify a typed 6-digit code against the newest live challenge for an e-mail. */
export async function verifyCode(
  email: string,
  code: string
): Promise<VerifyResult> {
  // The attempt is spent before comparing, so parallel guesses share the limit.
  const challenge = await loginChallenges.reserveAttempt(email);
  if (!challenge) return { ok: false, reason: "not_found" };

  if (!hashesMatch(challenge.code_hash, hashSecret(code))) {
    return {
      ok: false,
      reason:
        challenge.attempts >= loginChallenges.MAX_CODE_ATTEMPTS
          ? "too_many_attempts"
          : "invalid_code",
    };
  }

  // Consume last: the UPDATE only succeeds once, which is what stops the code
  // and its magic link from both being redeemed.
  if (!(await loginChallenges.consume(challenge.id))) {
    return { ok: false, reason: "already_used" };
  }

  return { ok: true, email: challenge.email, attendeeId: challenge.attendee_id };
}

/** Verify a magic-link token from the e-mail. */
export async function verifyToken(token: string): Promise<VerifyResult> {
  const challenge = await loginChallenges.findLiveByTokenHash(hashSecret(token));
  if (!challenge) return { ok: false, reason: "not_found" };

  if (!(await loginChallenges.consume(challenge.id))) {
    return { ok: false, reason: "already_used" };
  }

  return { ok: true, email: challenge.email, attendeeId: challenge.attendee_id };
}
