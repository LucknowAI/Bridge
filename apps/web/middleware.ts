import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "mb_session";

/** The login route can skip its form when a session cookie is present. */
export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = `/e/${process.env.DEFAULT_EVENT_SLUG || "demo"}`;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/login"] };
