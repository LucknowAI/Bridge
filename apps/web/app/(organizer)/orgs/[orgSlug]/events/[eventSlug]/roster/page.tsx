import Link from "next/link";
import { importEventRosterAction } from "../../../../../../actions/organizer.actions";
import { requireOrganizerEvent } from "@/src/lib/auth";
import { RosterUploadForm } from "@/components/organizer/EventForms";

export default async function RosterPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
  searchParams: Promise<{ imported?: string }>;
}) {
  const { orgSlug, eventSlug } = await params;
  const query = await searchParams;
  const { event, container } = await requireOrganizerEvent(orgSlug, eventSlug);
  const roster = await container.events.roster(event.id);
  const action = importEventRosterAction.bind(null, orgSlug, eventSlug);
  return <main style={shell}>
    <nav><Link href={`/orgs/${orgSlug}/events/${eventSlug}`}>← Dashboard</Link><Link href={`/orgs/${orgSlug}/events/${eventSlug}/matching`}>Matching</Link></nav>
    <h1>Attendee roster</h1>
    <p>{roster.length} registered attendee{roster.length === 1 ? "" : "s"} for {event.name}.</p>
    {query.imported && <p role="status" className="notice">Added {query.imported} attendee(s) to this event.</p>}
    <RosterUploadForm action={action} />
    <div style={{ overflowX: "auto", marginTop: 28 }}><table style={table}>
      <thead><tr><th>Name</th><th>E-mail</th><th>Phone</th><th>Role</th><th>Domain</th><th>Profile</th></tr></thead>
      <tbody>{roster.map((person) => <tr key={String(person.id)}>
        <td>{String(person.name ?? "—")}</td><td>{String(person.email ?? "—")}</td><td>{String(person.phone ?? "—")}</td>
        <td>{String(person.designation ?? "—")}</td><td>{String(person.domain ?? "—")}</td>
        <td>{person.profile_updated_at ? "Complete" : "Invited"}</td>
      </tr>)}</tbody>
    </table></div>
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 1100, margin: "0 auto", padding: "36px 24px", color: "#f4f4f5" } as const;
const table = { width: "100%", borderCollapse: "collapse" as const, textAlign: "left" as const };
