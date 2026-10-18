import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired (R09). This roster lookup returned an attendee's name and e-mail
 * for any phone number or address, without a rate limit, so it could be used
 * to enumerate the roster. The login page never called it: sign-in goes
 * through /api/auth/otp/request, which is rate limited per e-mail and per IP.
 *
 * The route file stays so old clients get a clear answer instead of a 404.
 */
export async function POST() {
  return NextResponse.json({ error: "This endpoint has been retired." }, { status: 410 });
}
