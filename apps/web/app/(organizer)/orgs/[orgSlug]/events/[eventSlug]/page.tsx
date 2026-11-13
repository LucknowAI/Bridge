import Link from "next/link";
import { updateEventAction } from "../../../../../actions/organizer.actions";
import { requireOrganizerEvent } from "@/src/lib/auth";

export default async function EventDashboardPage({ params }: { params: Promise<{ orgSlug: string; eventSlug: string }> }) {
  const { orgSlug, eventSlug } = await params;
  const { event, container } = await requireOrganizerEvent(orgSlug, eventSlug);
  const analytics = await container.events.analytics(event.id);
  const action = updateEventAction.bind(null, orgSlug, eventSlug);
  return <main style={shell}>
    <span style={{ color: "#f59e0b", fontSize: 12, letterSpacing: 2 }}>ORGANIZER · {event.organization_name}</span>
    <h1>{event.name}</h1>
    <p>{event.description}</p>
    <nav>
      <Link href={`/orgs/${orgSlug}/events/${eventSlug}/roster`}>Roster</Link>
      <Link href={`/orgs/${orgSlug}/events/${eventSlug}/matching`}>Matching</Link>
      <Link href={`/orgs/${orgSlug}/events/${eventSlug}/analytics`}>Analytics</Link>
      <Link href={`/orgs/${orgSlug}/events/new`}>Create event</Link>
    </nav>
    <section style={stats}>
      <Stat label="Registered" value={analytics.roster} />
      <Stat label="Profiles" value={analytics.profiles} />
      <Stat label="Ranked matches" value={analytics.matches} />
      <Stat label="Accepted intros" value={analytics.acceptedIntros} />
    </section>
    <h2>Event setup</h2>
    <form action={action} style={form}>
      <label>Event name<input name="name" defaultValue={event.name} required maxLength={120} /></label>
      <label>Description<textarea name="description" defaultValue={event.description ?? ""} rows={3} /></label>
      <label>Registration status<select name="status" defaultValue={event.status}>
        <option value="draft">Draft</option><option value="open">Open registration</option><option value="closed">Closed</option>
      </select></label>
      <label>Supported intents, comma separated<input name="intents" defaultValue={event.intents.join(", ")} /></label>
      <label>Venue zones, comma separated<input name="zones" defaultValue={event.zones.join(", ")} placeholder="Main hall, Workshop room" /></label>
      <button style={button}>Save event configuration</button>
    </form>
  </main>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div style={stat}><strong>{value}</strong><span>{label}</span></div>;
}

const shell = { minHeight: "100vh", maxWidth: 1040, margin: "0 auto", padding: "36px 24px 80px", color: "#f4f4f5" } as const;
const stats = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, margin: "28px 0" } as const;
const stat = { display: "grid", gap: 6, background: "#151519", borderRadius: 12, padding: 18, border: "1px solid #333" } as const;
const form = { display: "grid", gap: 14, maxWidth: 680, marginTop: 20 } as const;
const button = { border: 0, borderRadius: 8, padding: 13, background: "#f59e0b", color: "#0a0a0e", fontWeight: 700, cursor: "pointer" } as const;
