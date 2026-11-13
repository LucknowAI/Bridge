import { cookies } from "next/headers";
import {
  getSessionConfig,
  sealSession,
  unsealSession,
  sessionCookieOptions,
  isSessionActive,
  logoutUser,
  type Session,
} from "@match-maker/auth";
import { attendees, events } from "@match-maker/db";
import { safeReturnTo } from "./safe-return-to";

export type { Session };

/** Read and validate the session cookie. Returns null when signed out. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(getSessionConfig().cookieName)?.value;
  const session = raw ? await unsealSession(raw) : null;
  // A disabled account, revoked sessions, or a disabled Keycloak user end it now.
  return session && (await isSessionActive(session)) ? session : null;
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

/**
 * Google sign-ins also hold a Keycloak SSO session. Ending it server-side means
 * the next Google sign-in starts fresh, without sending the browser through
 * Keycloak's "Do you want to log out?" page. Never blocks signing out.
 */
export async function endIdentityProviderSession(session: Session | null): Promise<void> {
  if (session?.method !== "google") return;
  try {
    await logoutUser(session.sub);
  } catch (error) {
    console.error("[auth] could not end the Keycloak session:", error);
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(getSessionConfig().cookieName, "", sessionCookieOptions(0));
}

/**
 * Client IP as reported by our own proxies, or null when unknown.
 *
 * Each proxy appends the address it saw to `x-forwarded-for`, and anything to
 * the left of that may be written by the caller. With TRUSTED_PROXY_HOPS
 * proxies in front of us (1 behind the ALB), the client is the entry that many
 * places from the end. 0 (local development) trusts no header at all.
 * Used only for rate limiting, never for authorization.
 */
export function clientIp(request: Request, hops = Number(process.env.TRUSTED_PROXY_HOPS || 0)): string | null {
  if (!Number.isInteger(hops) || hops < 1) return null;
  const entries = (request.headers.get("x-forwarded-for") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length >= hops ? entries[entries.length - hops]! : null;
}

/** Apply the event roster gate before issuing an event-specific login session. */
export async function canReturnToPath(returnTo: string | null | undefined, attendeeId: string): Promise<boolean> {
  // Every sign-in path checks this, so a disabled account cannot sign in at all.
  const account = await attendees.accountState(attendeeId);
  if (!account || account.disabled_at) return false;
  returnTo = safeReturnTo(returnTo);
  const participantRoute = returnTo.match(/^\/e\/([^/]+)(?:\/|$)/);
  if (participantRoute) {
    const event = await events.findByEventSlug(participantRoute[1]);
    return Boolean(event && await events.isParticipant(event.id, attendeeId));
  }
  // The event list and "new event" pages belong to the organization, not to an event.
  const organizationRoute = returnTo.match(/^\/orgs\/([^/]+)\/events(\/new)?\/?$/);
  if (organizationRoute) {
    if (await events.hasOrganizationAccess(organizationRoute[1], attendeeId)) return true;
    // Organizers of one event may open the list (not the new-event page).
    return !organizationRoute[2] && (await events.listForOrganization(organizationRoute[1], attendeeId)).length > 0;
  }
  const organizerRoute = returnTo.match(/^\/orgs\/([^/]+)\/events\/([^/]+)(?:\/|$)/);
  if (organizerRoute) {
    const event = await events.findBySlug(organizerRoute[1], organizerRoute[2]);
    return Boolean(event && await events.isOrganizer(event.id, attendeeId));
  }
  return true;
}
