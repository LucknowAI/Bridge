import { cookies } from "next/headers";
import {
  getSessionConfig,
  sealSession,
  unsealSession,
  sessionCookieOptions,
  type Session,
} from "@match-maker/auth";
import { events } from "@match-maker/db";
import { safeReturnTo } from "./safe-return-to";

export type { Session };

/** Read and validate the session cookie. Returns null when signed out. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(getSessionConfig().cookieName)?.value;
  return raw ? unsealSession(raw) : null;
}

/** Issue a session cookie for a freshly authenticated user. */
export async function setSession(
  session: Omit<Session, "iat">
): Promise<void> {
  const config = getSessionConfig();
  const store = await cookies();
  store.set(
    config.cookieName,
    await sealSession(session),
    sessionCookieOptions(config.maxAge)
  );
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(getSessionConfig().cookieName, "", sessionCookieOptions(0));
}

/**
 * Client IP as seen behind the ALB.
 *
 * `x-forwarded-for` accumulates hops, and only the *last* entry is added by a
 * trusted proxy — but ECS sits behind exactly one ALB, so the first entry is
 * the real client. Used only for rate-limit bookkeeping, never for authz.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}

/** Apply the event roster gate before issuing an event-specific login session. */
export async function canReturnToPath(returnTo: string | null | undefined, attendeeId: string): Promise<boolean> {
  returnTo = safeReturnTo(returnTo);
  const participantRoute = returnTo.match(/^\/e\/([^/]+)(?:\/|$)/);
  if (participantRoute) {
    const event = await events.findByEventSlug(participantRoute[1]);
    return Boolean(event && await events.isParticipant(event.id, attendeeId));
  }
  const organizerRoute = returnTo.match(/^\/orgs\/([^/]+)\/events\/([^/]+)(?:\/|$)/);
  if (organizerRoute) {
    const event = await events.findBySlug(organizerRoute[1], organizerRoute[2]);
    return Boolean(event && await events.isOrganizer(event.id, attendeeId));
  }
  return true;
}
