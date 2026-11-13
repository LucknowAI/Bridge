import { NextResponse } from "next/server";
import { clearSession, endIdentityProviderSession, getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign out. Clears the local session, and for Google logins also ends the
 * Keycloak SSO session server-side — otherwise the next sign-in would silently
 * re-use it and appear to ignore the logout. Same behaviour as the Sign out
 * button (signOutCurrentUser).
 */
export async function POST() {
  const session = await getSession();
  await clearSession();
  await endIdentityProviderSession(session);
  return NextResponse.json({ ok: true, redirectTo: "/login" });
}
