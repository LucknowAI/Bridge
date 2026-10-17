import { NextResponse } from "next/server";
import { attendees } from "@match-maker/db";
import { canReturnToPath } from "@/lib/session";
import { loginErrorPath, safeReturnTo } from "@/lib/safe-return-to";
import {
  exchangeCodeForTokens,
  verifyIdToken,
  unsealOAuthState,
  verifyToken,
  ensureUser,
  sealSession,
  sessionCookieOptions,
  getSessionConfig,
  OAUTH_COOKIE_NAME,
} from "@match-maker/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The single return point for both login methods.
 *
 *   ?token=…            magic link from the login e-mail
 *   ?code=…&state=…     authorization code from Keycloak (Google)
 *
 * This replaced the old client-side callback page. Running server-side means
 * the code and token are redeemed without ever being handed to browser
 * JavaScript, and the user lands on the destination in one redirect.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const origin = process.env.APP_BASE_URL || url.origin;

  const providerError = url.searchParams.get("error");
  if (providerError) {
    // A cancelled Google consent lands here; the state cookie still knows
    // which event the user was joining.
    console.warn("[auth/callback] provider error:", providerError);
    const stored = await unsealOAuthState(request.cookies.get(OAUTH_COOKIE_NAME)?.value ?? "");
    return redirectTo(origin, loginErrorPath("provider", stored?.returnTo));
  }

  const token = url.searchParams.get("token");
  if (token) return handleMagicLink(token, origin, safeReturnTo(url.searchParams.get("returnTo")));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code && state) return handleAuthorizationCode(request, code, state, origin);

  return redirectTo(origin, loginErrorPath("invalid_callback", url.searchParams.get("returnTo")));
}

async function handleMagicLink(token, origin, returnTo) {
  try {
    const result = await verifyToken(token);
    if (!result.ok) {
      return redirectTo(origin, loginErrorPath(result.reason, returnTo));
    }

    const attendee = result.attendeeId
      ? await attendees.findById(result.attendeeId)
      : await attendees.findByEmail(result.email);

    if (!attendee) return redirectTo(origin, loginErrorPath("unregistered", returnTo));
    if (!(await canReturnToPath(returnTo, attendee.id))) return redirectTo(origin, loginErrorPath("unregistered", returnTo));

    const subject = await ensureUser(attendee.email, attendee.name);
    return await redirectWithSession(origin, returnTo, {
      sub: subject,
      email: attendee.email,
      name: attendee.name,
      attendeeId: attendee.id,
      method: "email",
    });
  } catch (err) {
    console.error("[auth/callback] magic link:", err);
    return redirectTo(origin, loginErrorPath("verification_failed", returnTo));
  }
}

async function handleAuthorizationCode(request, code, state, origin) {
  let stored = null;
  try {
    stored = await unsealOAuthState(
      request.cookies.get(OAUTH_COOKIE_NAME)?.value ?? ""
    );

    // No cookie means the flow was started in another browser or expired;
    // a mismatch means someone tried to inject their own authorization code.
    if (!stored || stored.state !== state) {
      return redirectTo(origin, loginErrorPath("state_mismatch", stored?.returnTo));
    }

    const tokens = await exchangeCodeForTokens(code, stored.codeVerifier);
    const claims = await verifyIdToken(tokens.id_token, stored.nonce);

    const email = claims.email?.toLowerCase().trim();
    const returnTo = safeReturnTo(stored.returnTo);
    if (!email) return redirectTo(origin, loginErrorPath("no_email", returnTo));
    if (claims.email_verified !== true) return redirectTo(origin, loginErrorPath("email_unverified", returnTo));

    // The roster is still the gate: a valid Google account that is not an
    // attendee gets no session, matching the previous sign-out-on-callback
    // behaviour.
    const attendee = await attendees.findByEmail(email);
    if (!attendee) return redirectTo(origin, loginErrorPath("unregistered", returnTo));
    if (!(await canReturnToPath(returnTo, attendee.id))) return redirectTo(origin, loginErrorPath("unregistered", returnTo));

    const response = await redirectWithSession(origin, returnTo, {
      sub: claims.sub,
      email,
      name: attendee.name ?? claims.name ?? null,
      attendeeId: attendee.id,
      method: "google",
    });

    return response;
  } catch (err) {
    console.error("[auth/callback] authorization code:", err);
    return redirectTo(origin, loginErrorPath("verification_failed", stored?.returnTo));
  }
}

async function redirectWithSession(origin, path, session) {
  const config = getSessionConfig();
  const response = redirectTo(origin, path);
  response.cookies.set(
    config.cookieName,
    await sealSession(session),
    sessionCookieOptions(config.maxAge)
  );
  return response;
}

function redirectTo(origin, path) {
  const response = NextResponse.redirect(new URL(safeReturnTo(path), origin));
  response.cookies.set(OAUTH_COOKIE_NAME, "", sessionCookieOptions(0));
  return response;
}
