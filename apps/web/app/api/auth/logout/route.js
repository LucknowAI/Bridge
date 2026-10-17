import { NextResponse } from "next/server";
import { buildLogoutUrl } from "@match-maker/auth";
import { clearSession, getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign out. Clears the local session, and for Google logins also ends the
 * Keycloak SSO session — otherwise the next sign-in would silently re-use it
 * and appear to ignore the logout.
 */
export async function POST(request) {
  const session = await getSession();
  await clearSession();

  const origin = process.env.APP_BASE_URL || new URL(request.url).origin;

  if (session?.method === "google") {
    try {
      return NextResponse.json({
        ok: true,
        redirectTo: await buildLogoutUrl(`${origin}/login`),
      });
    } catch (err) {
      // Keycloak being unreachable must not trap the user in a signed-in state;
      // the local cookie is already gone.
      console.error("[auth/logout] could not build Keycloak logout URL:", err);
    }
  }

  return NextResponse.json({ ok: true, redirectTo: "/login" });
}
