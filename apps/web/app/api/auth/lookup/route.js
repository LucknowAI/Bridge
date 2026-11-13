import { NextResponse } from "next/server";
import { attendees } from "@match-maker/db";
import { canReturnToPath } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Roster gate. Given a phone number or an e-mail, report whether that person is
 * on the attendee list, and for the phone path return the e-mail the login
 * message will go to.
 *
 * Previously the browser queried Supabase directly with the anon key. It now
 * goes through this route, so the database credential never leaves the server.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { phone, email, returnTo } = body;

    if (!phone && !email) {
      return NextResponse.json(
        { error: "Provide a phone number or an e-mail address" },
        { status: 400 }
      );
    }

    const attendee = phone
      ? await attendees.findByPhone(String(phone))
      : await attendees.findByEmail(String(email));

    if (!attendee?.email) {
      // Deliberately identical shape for "no such row" and "row without e-mail"
      // so the response cannot be used to probe the roster.
      return NextResponse.json({ registered: false });
    }
    if (!(await canReturnToPath(returnTo, attendee.id))) return NextResponse.json({ registered: false });

    return NextResponse.json({
      registered: true,
      // The phone path shows this address on the confirmation screen, so it is
      // masked here rather than returning the full address to the browser.
      email: phone ? maskEmail(attendee.email) : attendee.email,
      name: attendee.name,
    });
  } catch (err) {
    console.error("[auth/lookup]", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}

function maskEmail(email) {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${"•".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}
