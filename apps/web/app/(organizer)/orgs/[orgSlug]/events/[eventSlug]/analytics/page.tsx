import Link from "next/link";
import SignOutButton from "@/components/ui/SignOutButton";
import { requireOrganizerEvent } from "@/src/lib/auth";

export default async function AnalyticsPage({ params }: { params: Promise<{ orgSlug: string; eventSlug: string }> }) {
  const { orgSlug, eventSlug } = await params;
  const { event, container } = await requireOrganizerEvent(orgSlug, eventSlug);
  const analytics = await container.events.analytics(event.id);
  const completion = analytics.roster ? Math.round(analytics.profiles / analytics.roster * 100) : 0;
  return <main style={shell}>
    <nav><Link href={`/orgs/${orgSlug}/events/${eventSlug}`}>← Dashboard</Link><Link href={`/orgs/${orgSlug}/events/${eventSlug}/roster`}>Roster</Link><Link href={`/orgs/${orgSlug}/events/${eventSlug}/matching`}>Matching</Link><SignOutButton /></nav>
    <h1>Event analytics</h1>
    <p>{event.name} · {event.status}</p>
    <section style={grid}>
      <Card label="Roster size" value={analytics.roster} note={analytics.removed ? `${analytics.removed} removed` : undefined} />
      <Card label="Invitations sent" value={analytics.invited} />
      <Card label="Claimed accounts" value={analytics.claimed} />
      <Card label="Profile completion" value={`${completion}%`} note={`${analytics.profiles} profiles`} />
      <Card label="Persisted match rows" value={analytics.matches} />
      <Card label="Pending introductions" value={analytics.pendingIntros} />
      <Card label="Accepted introductions" value={analytics.acceptedIntros} />
    </section>
  </main>;
}

function Card({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return <article style={card}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}

const shell = { minHeight: "100vh", maxWidth: 1000, margin: "0 auto", padding: "36px 24px", color: "#f4f4f5" } as const;
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14, marginTop: 28 } as const;
const card = { display: "grid", gap: 10, padding: 20, background: "#151519", border: "1px solid #333", borderRadius: 12 } as const;
