import { NextResponse, type NextRequest } from "next/server";
import { getSessionConfig, sessionCookieOptions, unsealSession } from "@match-maker/auth";
import { postLoginPath } from "./lib/safe-return-to";

/**
 * A valid session skips the login form and continues to `returnTo`. An expired
 * or tampered cookie is cleared so the form shows instead of bouncing the user
 * away. An `?error=` stays on the form so the user can switch accounts.
 */
export async function middleware(request: NextRequest) {
  const { cookieName } = getSessionConfig();
  const raw = request.cookies.get(cookieName)?.value;
  if (!raw) return NextResponse.next();

  const { searchParams } = request.nextUrl;
  const session = await unsealSession(raw);
  if (session && !searchParams.has("error")) {
    return NextResponse.redirect(new URL(postLoginPath(searchParams.get("returnTo")), request.url));
  }

  const response = NextResponse.next();
  if (!session) response.cookies.set(cookieName, "", sessionCookieOptions(0));
  return response;
}

// Session cookies are decrypted with node:crypto, so this cannot run on Edge.
export const config = { runtime: "nodejs", matcher: ["/login"] };
