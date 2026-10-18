import { attendees } from "@match-maker/db";
import { isUserEnabled } from "./keycloak";
import type { Session } from "./session";

/**
 * Whether a cryptographically valid session may still be used. The cookie is
 * self-contained, so this is what makes disabling an account, "sign out
 * everywhere", and disabling or deleting the Keycloak user take effect on the
 * next request instead of when the cookie expires.
 */
export async function isSessionActive(session: Session): Promise<boolean> {
  const account = await attendees.accountState(session.attendeeId);
  if (!account || account.disabled_at) return false;
  if (account.sessions_revoked_at && session.iat * 1000 < account.sessions_revoked_at.getTime()) return false;
  return isUserEnabled(session.sub);
}
