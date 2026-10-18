import Link from "next/link";
import SignOutButton from "@/components/ui/SignOutButton";
import { requireOrganizationMember } from "@/src/lib/auth";

export default async function OrganizationEventsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { session, organization, container, isMember } = await requireOrganizationMember(orgSlug, `/orgs/${orgSlug}/events`, { allowEventOrganizers: true });
  const events = await container.events.listForOrganization(orgSlug, session.attendeeId);
  return <main style={{ minHeight: "100vh", maxWidth: 900, margin: "0 auto", padding: "40px 24px", color: "#f4f4f5" }}>
    <span style={{ color: "#f59e0b", letterSpacing: 2, fontSize: 12 }}>ORGANIZER</span>
    <nav><SignOutButton /></nav>
    <h1>{organization.name} events</h1>
    {isMember && <Link href={`/orgs/${orgSlug}/events/new`} style={button}>Create event</Link>}
    <div style={{ display: "grid", gap: 12, marginTop: 28 }}>
      {events.map((event) => <Link key={event.id} href={`/orgs/${orgSlug}/events/${event.slug}`} style={card}>
        <strong>{event.name}</strong><span>{event.status}</span><span>{event.description}</span>
      </Link>)}
    </div>
  </main>;
}

const button = { display: "inline-block", padding: 12, borderRadius: 8, background: "#f59e0b", color: "#0a0a0e", textDecoration: "none", fontWeight: 700 } as const;
const card = { display: "grid", gap: 8, padding: 18, border: "1px solid #333", borderRadius: 12, background: "#151519", color: "#f4f4f5", textDecoration: "none" } as const;
