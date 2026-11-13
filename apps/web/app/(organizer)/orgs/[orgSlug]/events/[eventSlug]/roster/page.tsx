import Link from "next/link";
import { importEventRosterAction } from "../../../../../../actions/organizer.actions";
import { requireOrganizerEvent } from "@/src/lib/auth";

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
    {query.imported && <p role="status" style={{ color: "#86efac" }}>Added {query.imported} attendee(s) to this event.</p>}
    <form action={action} encType="multipart/form-data" style={upload}>
      <label>Import an Excel roster (.xlsx or .xls)<input type="file" name="file" accept=".xlsx,.xls" required /></label>
      <button style={button}>Import roster</button>
    </form>
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
const upload = { display: "flex", flexWrap: "wrap", alignItems: "end", gap: 16, padding: 20, background: "#151519", borderRadius: 12 } as const;
const table = { width: "100%", borderCollapse: "collapse" as const, textAlign: "left" as const };
const button = { border: 0, borderRadius: 8, padding: "12px 16px", background: "#f59e0b", color: "#0a0a0e", fontWeight: 700, cursor: "pointer" } as const;
