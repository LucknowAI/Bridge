import Link from "next/link";
import SignOutButton from "@/components/ui/SignOutButton";
import { requireOrganizerEvent } from "@/src/lib/auth";

export default async function AnalyticsPage({ params }: { params: Promise<{ orgSlug: string; eventSlug: string }> }) {
  const { orgSlug, eventSlug } = await params;
  const { event, container } = await requireOrganizerEvent(orgSlug, eventSlug);
  const [analytics, activity] = await Promise.all([container.events.analytics(event.id), container.audit.recent(event.id)]);
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
    <h2>Recent activity</h2>
    {!activity.length ? <p className="empty-state">No recorded activity yet.</p> : <ul style={{ display: "grid", gap: 8, padding: 0, listStyle: "none" }}>
      {activity.map((item) => <li key={item.id} style={{ padding: "10px 14px", borderRadius: 10, background: "#151519" }}>
        <strong>{ACTIVITY_LABELS[item.action] ?? item.action}</strong>
        {item.subjectName && <> · {item.subjectName}</>}
        <br /><small style={{ color: "var(--muted)" }}>{item.actorName ?? "System"} · {item.createdAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{summary(item.details)}</small>
      </li>)}
    </ul>}
  </main>;
}

const ACTIVITY_LABELS: Record<string, string> = {
  "roster.imported": "Roster imported",
  "invitations.sent": "Invitations sent",
  "access.removed": "Access removed",
  "access.restored": "Access restored",
  "event.updated": "Settings changed",
  "profile_form.updated": "Profile form changed",
  "contacts.revealed": "Introduction accepted, contacts shared",
};

function summary(details: Record<string, unknown>): string {
  const parts = ["attached", "sent", "failed", "version"].filter((key) => typeof details[key] === "number").map((key) => `${key} ${details[key]}`);
  return parts.length ? ` · ${parts.join(", ")}` : "";
}

function Card({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return <article style={card}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}

const shell = { minHeight: "100vh", maxWidth: 1000, margin: "0 auto", padding: "36px 24px", color: "#f4f4f5" } as const;
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14, marginTop: 28 } as const;
const card = { display: "grid", gap: 10, padding: 20, background: "#151519", border: "1px solid #333", borderRadius: 12 } as const;
