import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "mb_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return SAFE_METHODS.has(request.method) || isSameOrigin(request)
      ? NextResponse.next()
      : NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
  }

  // The login route can skip its form when a session cookie is present.
  if (request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = `/e/${process.env.DEFAULT_EVENT_SLUG || "demo"}`;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
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

export const config = { matcher: ["/login", "/api/:path*"] };
