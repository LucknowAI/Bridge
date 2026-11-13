/**
 * Account administration for one person, across every event:
 *
 *   npm run account:disable -- <email>          no sign-in, every session ended
 *   npm run account:enable -- <email>           undo a disable
 *   npm run account:revoke-sessions -- <email>  sign out everywhere, keep the account
 *   npm run account:erase -- <email> --yes      delete the person and their data (deletion request)
 *
 * Changes the database (which every request checks) and the Keycloak user, so
 * Google sign-in stops too. Event-level removal is on the organizer roster page.
 */
import "dotenv/config";
import { attendees, audit, closePool } from "@match-maker/db";
import { deleteUser, findUserByEmail, logoutUser, setUserEnabled } from "@match-maker/auth";
import { isMainModule } from "../packages/db/src/is-main";

export type AccountCommand = "disable" | "enable" | "revoke-sessions" | "erase";

export async function manageAccount(command: AccountCommand, email: string): Promise<string[]> {
  if (command === "erase") return eraseAccount(email);
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
  const subject = (await attendees.findByEmail(email))?.id ?? null;
  await audit.record({ action: `account.${command === "revoke-sessions" ? "sessions_revoked" : command === "enable" ? "enabled" : "disabled"}`, subjectId: subject });
  return report;
}

/** Deletes the Keycloak user first, so a failure there leaves the data intact to retry. */
async function eraseAccount(email: string): Promise<string[]> {
  const report: string[] = [];
  const user = await findUserByEmail(email);
  if (user) {
    await deleteUser(user.id);
    report.push("keycloak: user deleted");
  } else {
    report.push("keycloak: no user");
  }
  const erased = await attendees.erase(email);
  if (!erased) throw new Error(`No attendee has the e-mail ${email}`);
  await audit.record({ action: "account.erased", subjectId: erased });
  report.push("database: attendee, event profiles, matches, introductions and cached explanations deleted");
  return report;
}

if (isMainModule(import.meta.url)) {
  const [command, email, confirm] = process.argv.slice(2);
  if (!["disable", "enable", "revoke-sessions", "erase"].includes(command ?? "") || !email) {
    console.error("Usage: tsx tools/manage-account.ts <disable|enable|revoke-sessions|erase> <email> [--yes]");
    process.exit(1);
  }
  if (command === "erase" && confirm !== "--yes") {
    console.error("[account] erase deletes the person and their data permanently; re-run with --yes to confirm.");
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
