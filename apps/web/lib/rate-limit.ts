import { NextResponse } from "next/server";
import { PostgresRateLimiter } from "../src/infrastructure/cache/postgres-rate-limiter";
import { clientIp } from "./session";

const limiter = new PostgresRateLimiter();

/** Per-IP limits for the sign-in endpoints, shared by every web replica. */
export const IP_LIMITS = {
  otpRequest: { limit: 10, windowSeconds: 15 * 60 },
  otpVerify: { limit: 30, windowSeconds: 15 * 60 },
} as const;

/**
 * Counts this request against the caller's IP and returns a 429 response once
 * the limit is passed, or null to continue. Skipped when the IP is unknown
 * (TRUSTED_PROXY_HOPS=0, local development).
 */
export async function limitByIp(request: Request, scope: keyof typeof IP_LIMITS): Promise<NextResponse | null> {
  const ip = clientIp(request);
  if (!ip) return null;
  const { limit, windowSeconds } = IP_LIMITS[scope];
  if (await limiter.consume(`ip:${scope}:${ip}`, limit, windowSeconds)) return null;
  return NextResponse.json(
    { error: "Too many sign-in attempts from this network. Please wait a few minutes and try again." },
    { status: 429, headers: { "Retry-After": String(windowSeconds) } }
  );
}

/** JSON endpoints refuse other bodies, so a plain cross-site form cannot post to them. */
export function requireJson(request: Request): NextResponse | null {
  const type = request.headers.get("content-type") ?? "";
  return type.toLowerCase().startsWith("application/json")
    ? null
    : NextResponse.json({ error: "Send the request as JSON" }, { status: 415 });
}
