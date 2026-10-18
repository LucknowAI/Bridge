/**
 * Account administration for one person, across every event:
 *
 *   npm run account:disable -- <email>          no sign-in, every session ended
 *   npm run account:enable -- <email>           undo a disable
 *   npm run account:revoke-sessions -- <email>  sign out everywhere, keep the account
 *
 * Changes the database (which every request checks) and the Keycloak user, so
 * Google sign-in stops too. Event-level removal is on the organizer roster page.
 */
import "dotenv/config";
import { attendees, closePool } from "@match-maker/db";
import { findUserByEmail, logoutUser, setUserEnabled } from "@match-maker/auth";
import { isMainModule } from "../packages/db/src/is-main";

export type AccountCommand = "disable" | "enable" | "revoke-sessions";

export async function manageAccount(command: AccountCommand, email: string): Promise<string[]> {
  const report: string[] = [];
  const known = command === "revoke-sessions"
    ? await attendees.revokeSessions(email)
    : await attendees.setDisabled(email, command === "disable");
  if (!known) throw new Error(`No attendee has the e-mail ${email}`);
  report.push(`database: ${command === "enable" ? "account enabled" : command === "disable" ? "account disabled, sessions ended" : "sessions ended"}`);

  const user = await findUserByEmail(email);
  if (!user) {
    report.push("keycloak: no user yet (they have never signed in)");
  } else if (command === "revoke-sessions") {
    await logoutUser(user.id);
    report.push("keycloak: sessions ended");
  } else {
    await setUserEnabled(user.id, command === "enable");
    report.push(`keycloak: user ${command === "enable" ? "enabled" : "disabled"}`);
  }
  return report;
}

if (isMainModule(import.meta.url)) {
  const [command, email] = process.argv.slice(2);
  if (!["disable", "enable", "revoke-sessions"].includes(command ?? "") || !email) {
    console.error("Usage: tsx tools/manage-account.ts <disable|enable|revoke-sessions> <email>");
    process.exit(1);
  }
  try {
    for (const line of await manageAccount(command as AccountCommand, email)) console.info(`[account] ${line}`);
  } catch (error) {
    console.error(`[account] ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
