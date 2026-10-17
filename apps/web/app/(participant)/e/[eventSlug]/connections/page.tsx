import Link from "next/link";
import { getParticipantConnections, respondToParticipantIntro, shareVenueZoneAction } from "../../../../actions/intro.actions";
import { requireParticipantEvent } from "@/src/lib/auth";

export default async function ConnectionsPage({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const { event } = await requireParticipantEvent(eventSlug, `/e/${eventSlug}/connections`);
  const connections = await getParticipantConnections(eventSlug);
  return <main style={{ minHeight: "100vh", maxWidth: 900, margin: "0 auto", padding: "36px 24px", color: "#f4f4f5" }}>
    <nav><Link href={`/e/${eventSlug}/matches`}>← Matches</Link><Link href={`/e/${eventSlug}/search`}>Search</Link><Link href={`/e/${eventSlug}/profile`}>Edit profile</Link></nav>
    <span style={{ color: "#f59e0b", letterSpacing: 2, fontSize: 12 }}>INTRODUCTIONS · {event.name}</span>
    <h1>Connections</h1>
    {!connections.length ? <p>Your intro requests will show up here. Find someone you would like to meet from your matches or search.</p> : <div style={{ display: "grid", gap: 12 }}>
      {connections.map((connection) => <article key={connection.id} style={card}>
        <div style={{ flex: 1 }}>
          <h2>{connection.participant.name}</h2>
          <p style={muted}>{[connection.participant.designation, connection.participant.domain].filter(Boolean).join(" · ")}</p>
          <p>{connection.incoming ? "They requested to meet you." : "You requested an introduction."} · {connection.status}</p>
          {connection.message && <p style={muted}>“{connection.message}”</p>}
          {connection.status === "accepted" && connection.contact && <div style={contact}>
            <strong>Contact revealed</strong>
            {connection.contact.email && <div><a href={`mailto:${connection.contact.email}`}>{connection.contact.email}</a></div>}
            {connection.contact.phone && <div><a href={`tel:${connection.contact.phone}`}>{connection.contact.phone}</a></div>}
            {connection.contact.venueZone && <div>At the venue: {connection.contact.venueZone}</div>}
            {event.zones.length > 0 && <form action={shareVenueZoneAction.bind(null, eventSlug, connection.id)} style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <select name="venueZone" required defaultValue=""><option value="" disabled>Share where you are</option>{event.zones.map((zone) => <option key={zone}>{zone}</option>)}</select>
              <button style={button}>Ping zone</button>
            </form>}
          </div>}
        </div>
        {connection.incoming && connection.status === "pending" && <div style={{ display: "flex", gap: 8 }}>
          <form action={respondToParticipantIntro.bind(null, eventSlug, connection.id, true)}><button style={button}>Accept</button></form>
          <form action={respondToParticipantIntro.bind(null, eventSlug, connection.id, false)}><button style={secondary}>Decline</button></form>
        </div>}
      </article>)}
    </div>}
  </main>;
}

const card = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: 20, borderRadius: 12, background: "#151519", border: "1px solid #333" } as const;
const muted = { color: "#a1a1aa" } as const;
const contact = { background: "#111", border: "1px solid #3f3f46", borderRadius: 8, padding: 14, lineHeight: 1.8 } as const;
const button = { border: 0, borderRadius: 8, padding: "11px 16px", background: "#f59e0b", color: "#0a0a0e", fontWeight: 700, cursor: "pointer" } as const;
const secondary = { border: "1px solid #52525b", borderRadius: 8, padding: "10px 14px", background: "transparent", color: "#f4f4f5", cursor: "pointer" } as const;
