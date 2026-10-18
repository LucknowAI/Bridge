import { NextResponse } from "next/server";
import { attendees } from "@match-maker/db";
import { issueChallenge, getOtpConfig, RateLimitError } from "@match-maker/auth";
import { sendLoginEmail } from "@match-maker/email";
import { canReturnToPath, clientIp } from "@/lib/session";
import { safeReturnTo } from "@/lib/safe-return-to";
import { limitByIp, requireJson } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start an e-mail login. Accepts either a phone number or an e-mail address,
 * resolves it against the roster server-side, and sends one message containing
 * both a 6-digit code and a one-click magic link.
 *
 * The caller never learns the resolved address in full — it only gets a masked
 * form for display, so this endpoint cannot be used to turn phone numbers into
 * e-mail addresses.
 */
export async function POST(request) {
  try {
    const refused = requireJson(request) ?? await limitByIp(request, "otpRequest");
    if (refused) return refused;
    const { phone, email, returnTo: requestedReturnTo } = await request.json().catch(() => ({}));
    const returnTo = safeReturnTo(requestedReturnTo);

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
      return NextResponse.json({ registered: false });
    }
    if (!(await canReturnToPath(returnTo, attendee.id))) return NextResponse.json({ registered: false });

    const { code, token, expiresAt } = await issueChallenge({
      email: attendee.email,
      attendeeId: attendee.id,
      ipAddress: clientIp(request),
    });

    const baseUrl = (process.env.APP_BASE_URL || new URL(request.url).origin).replace(
      /\/$/,
      ""
    );

    const { ttlSeconds } = getOtpConfig();
    const result = await sendLoginEmail(attendee.email, {
      name: attendee.name,
      code,
      magicLinkUrl: `${baseUrl}/auth/callback?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(returnTo)}`,
      expiresInMinutes: Math.round(ttlSeconds / 60),
    });

    return NextResponse.json({
      registered: true,
      sent: true,
      email: maskEmail(attendee.email),
      expiresAt: expiresAt.toISOString(),
      // Surfaces the local no-API-key path so developers know why no e-mail
      // arrived; always true in production.
      delivered: result.delivered,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    console.error("[auth/otp/request]", err);
    return NextResponse.json(
      { error: "Could not send the login e-mail. Please try again." },
      { status: 500 }
    );
  }
}

function maskEmail(email) {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${"•".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

