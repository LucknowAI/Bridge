import { NextResponse } from "next/server";
import { attendees } from "@match-maker/db";
import { canReturnToPath } from "@/lib/session";
import { loginErrorPath, safeReturnTo } from "@/lib/safe-return-to";
import {
  buildAuthorizationUrl,
  createPkce,
  randomUrlSafe,
  sealOAuthState,
  sessionCookieOptions,
  OAUTH_COOKIE_NAME,
  OAUTH_COOKIE_MAX_AGE,
} from "@match-maker/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Begin Google sign-in.
 *
 * `kc_idp_hint` makes Keycloak forward straight to Google instead of rendering
 * its own login page, so the user's journey is unchanged from the Supabase
 * version: our login screen → Google → back here.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.toLowerCase().trim() || "";
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  try {
    // The browser already checked the roster, but that check is advisory —
    // re-run it here so the redirect itself cannot be forged.
    if (email) {
      const attendee = await attendees.findByEmail(email);
      if (!attendee || !(await canReturnToPath(returnTo, attendee.id))) {
        return NextResponse.redirect(new URL(loginErrorPath("unregistered", returnTo), url.origin));
      }
    }

    const { codeVerifier, codeChallenge } = createPkce();
    const state = randomUrlSafe(16);
    const nonce = randomUrlSafe(16);

    const authorizationUrl = await buildAuthorizationUrl({
      state,
      nonce,
      codeChallenge,
      loginHint: email || undefined,
      useGoogleIdp: true,
    });

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(
      OAUTH_COOKIE_NAME,
      await sealOAuthState({ state, nonce, codeVerifier, returnTo }),
      sessionCookieOptions(OAUTH_COOKIE_MAX_AGE)
    );
    return response;
  } catch (err) {
    console.error("[auth/google/start]", err);
    return NextResponse.redirect(new URL(loginErrorPath("provider", returnTo), url.origin));
  }
}

