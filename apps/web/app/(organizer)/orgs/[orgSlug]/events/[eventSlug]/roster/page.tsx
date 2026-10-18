import Link from "next/link";
import SignOutButton from "@/components/ui/SignOutButton";
import { importEventRosterAction, sendInvitationsAction, setAttendeeAccessAction } from "../../../../../../actions/organizer.actions";
import { requireOrganizerEvent } from "@/src/lib/auth";
import { RosterUploadForm } from "@/components/organizer/EventForms";
import { ActionForm } from "@/components/ui/form";
import { canInvite, invitationState, type InvitationState } from "@/src/domain/participant/invitation";

const STATE_LABELS: Record<InvitationState, string> = {
  not_invited: "Not invited",
  invited: "Invited",
  failed: "Invitation failed",
  claimed: "Signed in",
  complete: "Profile complete",
  removed: "Access removed",
};

const date = (value: unknown) => value instanceof Date ? value : value ? new Date(String(value)) : null;
const when = (value: Date | null) => value ? value.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";

export default async function RosterPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
  searchParams: Promise<{ imported?: string; skipped?: string; invited?: string; failed?: string; access?: string }>;
}) {
  const { orgSlug, eventSlug } = await params;
  const query = await searchParams;
  const { event, container } = await requireOrganizerEvent(orgSlug, eventSlug);
  const roster = (await container.events.roster(event.id)).map((person) => {
    const facts = {
      revokedAt: date(person.revoked_at), profileUpdatedAt: date(person.profile_updated_at), claimedAt: date(person.claimed_at),
      invitedAt: date(person.invited_at), inviteError: person.invite_error ? String(person.invite_error) : null,
    };
    return { person, facts, state: invitationState(facts) };
  });
  const counts = roster.reduce<Record<string, number>>((all, row) => ({ ...all, [row.state]: (all[row.state] ?? 0) + 1 }), {});
  const pending = (counts.not_invited ?? 0);
  const action = importEventRosterAction.bind(null, orgSlug, eventSlug);
  return <main style={shell}>
    <nav><Link href={`/orgs/${orgSlug}/events/${eventSlug}`}>← Dashboard</Link><Link href={`/orgs/${orgSlug}/events/${eventSlug}/matching`}>Matching</Link><SignOutButton /></nav>
    <h1>Attendee roster</h1>
    <p>{roster.length} attendee{roster.length === 1 ? "" : "s"} on the roster for {event.name}.</p>
    {query.imported && <p role="status" className="notice">
      Added {query.imported} attendee(s) to this event.
      {Number(query.skipped) > 0 && ` Skipped ${query.skipped} row(s) with a missing or invalid e-mail, or an e-mail/phone repeated in the file.`}
    </p>}
    {query.invited && <p role="status" className={Number(query.failed) > 0 ? "form-alert" : "notice"}>
      Sent {query.invited} invitation(s).{Number(query.failed) > 0 && ` ${query.failed} could not be delivered; see the roster for the reason.`}
    </p>}
    {query.access && <p role="status" className="notice">
      {query.access === "removed" ? "Access removed. They are signed out of this event and no longer appear in anyone's results." : "Access restored."}
    </p>}
    <RosterUploadForm action={action} />
    {roster.length > 0 && <section style={summary} aria-label="Invitation status">
      {(Object.keys(STATE_LABELS) as InvitationState[]).filter((state) => counts[state]).map((state) =>
        <span key={state}><strong>{counts[state]}</strong> {STATE_LABELS[state].toLowerCase()}</span>)}
      {pending > 0 && <ActionForm action={sendInvitationsAction.bind(null, orgSlug, eventSlug, null)}
        label={`Send invitations to ${pending} not yet invited`} pendingLabel="Sending invitations…" />}
    </section>}
    {!roster.length ? <p className="empty-state">No attendees yet. Import an Excel roster to invite people to this event.</p> :
    <div style={{ overflowX: "auto", marginTop: 20 }}><table style={table}>
      <thead><tr><th>Name</th><th>E-mail</th><th>Phone</th><th>Role</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
      <tbody>{roster.map(({ person, facts, state }) => {
        const id = String(person.id);
        const detail = state === "failed" ? facts.inviteError
          : state === "removed" ? `since ${when(facts.revokedAt)}`
          : state === "claimed" || state === "complete" ? `signed in ${when(date(person.claimed_at))}`
          : state === "invited" ? `${when(facts.invitedAt)}${Number(person.invite_count) > 1 ? ` · sent ${person.invite_count} times` : ""}`
          : "";
        return <tr key={id}>
          <td>{String(person.name ?? "—")}</td><td>{String(person.email ?? "—")}</td><td>{String(person.phone ?? "—")}</td>
          <td>{String(person.designation ?? "—")}</td>
          <td>{STATE_LABELS[state]}{detail && <><br /><small style={{ color: "var(--muted)" }}>{detail}</small></>}</td>
          <td><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {canInvite(facts) && state !== "not_invited" && <ActionForm action={sendInvitationsAction.bind(null, orgSlug, eventSlug, id)}
              label="Resend" pendingLabel="Sending…" secondary />}
            {state === "removed"
              ? <ActionForm action={setAttendeeAccessAction.bind(null, orgSlug, eventSlug, id, false)} label="Restore" pendingLabel="Restoring…" secondary />
              : <ActionForm action={setAttendeeAccessAction.bind(null, orgSlug, eventSlug, id, true)} label="Remove access" pendingLabel="Removing…" secondary />}
          </div></td>
        </tr>;
      })}</tbody>
    </table></div>}
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 1100, margin: "0 auto", padding: "36px 24px", color: "#f4f4f5" } as const;
const table = { width: "100%", borderCollapse: "collapse" as const, textAlign: "left" as const };
const summary = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 20px", marginTop: 24 } as const;
