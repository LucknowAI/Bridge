import { NextResponse, type NextRequest } from "next/server";
import { getSessionConfig, isSessionActive, sessionCookieOptions, unsealSession } from "@match-maker/auth";
import { postLoginPath } from "./lib/safe-return-to";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return SAFE_METHODS.has(request.method) || isSameOrigin(request)
      ? NextResponse.next()
      : NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
  }
  return loginRedirect(request);
}

/**
 * A valid session skips the login form and continues to `returnTo`. An expired
 * or tampered cookie is cleared so the form shows instead of bouncing the user
 * away. An `?error=` stays on the form so the user can switch accounts.
 */
async function loginRedirect(request: NextRequest) {
  const { cookieName } = getSessionConfig();
  const raw = request.cookies.get(cookieName)?.value;
  if (!raw) return NextResponse.next();

  const { searchParams } = request.nextUrl;
  const unsealed = await unsealSession(raw);
  // Same rule as getSession, or a revoked session would loop between /login
  // and the page that sent it there.
  const session = unsealed && (await isSessionActive(unsealed)) ? unsealed : null;
  if (session && !searchParams.has("error")) {
    return NextResponse.redirect(new URL(postLoginPath(searchParams.get("returnTo")), request.url));
  }

  const response = NextResponse.next();
  if (!session) response.cookies.set(cookieName, "", sessionCookieOptions(0));
  return response;
}

/**
 * Browsers always send Origin (or at least Referer) on cross-site POSTs, so a
 * page on another site cannot sign someone in or out through our API.
 * Requests with neither header come from non-browser clients and pass; server
 * actions have Next.js's own origin check.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const source = request.headers.get("origin") ?? originOf(request.headers.get("referer"));
  if (!source) return !request.headers.has("origin") && !request.headers.has("referer");
  const allowed = new Set([request.nextUrl.origin]);
  const configured = originOf(process.env.APP_BASE_URL ?? null);
  if (configured) allowed.add(configured);
  return allowed.has(source);
}

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Session cookies are decrypted with node:crypto, so this cannot run on Edge.
export const config = { runtime: "nodejs", matcher: ["/login", "/api/:path*"] };
