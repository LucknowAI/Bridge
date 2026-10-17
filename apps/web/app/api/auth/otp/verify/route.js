import { NextResponse } from "next/server";
import { attendees } from "@match-maker/db";
import { verifyCode, ensureUser, CODE_LENGTH } from "@match-maker/auth";
import { canReturnToPath, setSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE_MESSAGES = {
  not_found: "That code has expired. Request a new one.",
  expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many incorrect attempts. Request a new code.",
  invalid_code: "Incorrect code. Please check and try again.",
  already_used: "That code has already been used.",
};

/**
 * Redeem a typed 6-digit code and open a session.
 *
 * The identifier is re-resolved server-side rather than trusted from the body,
 * so a caller cannot submit someone else's e-mail with their own code.
 */
export async function POST(request) {
  try {
    const { phone, email, code, returnTo } = await request.json().catch(() => ({}));

    const normalizedCode = String(code ?? "").replace(/\D/g, "");
    if (normalizedCode.length !== CODE_LENGTH) {
      return NextResponse.json(
        { error: `Enter the ${CODE_LENGTH}-digit code from your e-mail.` },
        { status: 400 }
      );
    }

    const attendee = phone
      ? await attendees.findByPhone(String(phone))
      : email
        ? await attendees.findByEmail(String(email))
        : null;

    if (!attendee?.email) {
      return NextResponse.json(
        { error: FAILURE_MESSAGES.not_found },
        { status: 400 }
      );
    }
    if (!(await canReturnToPath(returnTo, attendee.id))) {
      return NextResponse.json({ error: FAILURE_MESSAGES.not_found }, { status: 400 });
    }

    const result = await verifyCode(attendee.email, normalizedCode);
    if (!result.ok) {
      return NextResponse.json(
        { error: FAILURE_MESSAGES[result.reason] ?? "Verification failed." },
        { status: result.reason === "too_many_attempts" ? 429 : 400 }
      );
    }

    // Give the account a Keycloak identity so an e-mail login and a later
    // Google login for the same address resolve to the same `sub`.
    const subject = await ensureUser(attendee.email, attendee.name);

    await setSession({
      sub: subject,
      email: attendee.email,
      name: attendee.name,
      attendeeId: attendee.id,
      method: "email",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/otp/verify]", err);
    return NextResponse.json(
      { error: "Verification failed. Please try again." },
      { status: 500 }
    );
  }
}
