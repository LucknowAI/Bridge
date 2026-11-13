import Link from "next/link";
import SignOutButton from "@/components/ui/SignOutButton";
import { answerLocationAction, getParticipantConnections, requestLocationAction, respondToParticipantIntro, shareVenueZoneAction } from "../../../../actions/intro.actions";
import { requireParticipantEvent } from "@/src/lib/auth";
import { ActionForm } from "@/components/ui/form";
import { eventAllows } from "@/src/domain/shared/event-lifecycle";

export default async function ConnectionsPage({ params, searchParams }: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{ requested?: string; location?: string; asked?: string; replied?: string; declined?: string }>;
}) {
  const { eventSlug } = await params;
  const notice = await searchParams;
  const { event } = await requireParticipantEvent(eventSlug, `/e/${eventSlug}/connections`, "viewMatches");
  const connections = await getParticipantConnections(eventSlug);
  return <main style={{ minHeight: "100vh", maxWidth: 900, margin: "0 auto", padding: "36px 24px", color: "#f4f4f5" }}>
    <nav><Link href={`/e/${eventSlug}/matches`}>← Matches</Link><Link href={`/e/${eventSlug}/search`}>Search</Link><Link href={`/e/${eventSlug}/profile`}>Edit profile</Link><SignOutButton /></nav>
    <span style={{ color: "#f59e0b", letterSpacing: 2, fontSize: 12 }}>INTRODUCTIONS · {event.name}</span>
    <h1>Connections</h1>
    {notice.requested && <p role="status" className="notice">Intro request sent. You will see their contact details once they accept.</p>}
    {notice.location && <p role="status" className="notice">Your venue zone is shared with all your accepted connections for 15 minutes.</p>}
    {notice.asked && <p role="status" className="notice">Request sent. They decide whether to share where they are.</p>}
    {notice.replied && <p role="status" className="notice">Your zone is shared with them for 15 minutes.</p>}
    {notice.declined && <p role="status" className="notice">Request declined. They have been told you would rather not share right now.</p>}
    {!connections.length ? <p>Your intro requests will show up here. Find someone you would like to meet from your matches or search.</p> : <div style={{ display: "grid", gap: 12 }}>
      {connections.map((connection) => <article key={connection.id} id={`intro-${connection.id}`} style={card}>
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
            {connection.locationAsked?.status === "answered" && <div>Replied: at {connection.locationAsked.zone}</div>}
            {connection.locationAsked?.status === "pending" && <div style={muted}>Asked where they are. Waiting for a reply.</div>}
            {connection.locationAsked?.status === "declined" && <div style={muted}>They would rather not share where they are right now.</div>}
            {event.zones.length > 0 && eventAllows(event.status, "shareZone") && <>
              {connection.locationIncoming && <div style={ask}>
                <strong>{connection.participant.name} is asking where you are.</strong> Sharing is up to you; only they will see it, for 15 minutes.
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  <ActionForm action={answerLocationAction.bind(null, eventSlug, connection.id, connection.locationIncoming.id, true)} label={`Share with ${connection.participant.name}`} pendingLabel="Sharing…">
                    <label className="visually-hidden" htmlFor={`reply-${connection.id}`}>Your venue zone</label>
                    <select id={`reply-${connection.id}`} name="venueZone" required defaultValue="">
                      <option value="" disabled>Choose where you are</option>{event.zones.map((zone) => <option key={zone}>{zone}</option>)}
                    </select>
                  </ActionForm>
                  <ActionForm action={answerLocationAction.bind(null, eventSlug, connection.id, connection.locationIncoming.id, false)} label="Not now" pendingLabel="Declining…" secondary />
                </div>
              </div>}
              {connection.locationAsked?.status !== "pending" && <ActionForm action={requestLocationAction.bind(null, eventSlug, connection.id)} label="Ask where they are" pendingLabel="Asking…" secondary />}
            </>}
            {event.zones.length > 0 && eventAllows(event.status, "shareZone") && <ActionForm action={shareVenueZoneAction.bind(null, eventSlug, connection.id)} label="Share with all my connections" pendingLabel="Sharing…">
              <label className="visually-hidden" htmlFor={`zone-${connection.id}`}>Your venue zone</label>
              <select id={`zone-${connection.id}`} name="venueZone" required defaultValue="">
                <option value="" disabled>Choose where you are</option>{event.zones.map((zone) => <option key={zone}>{zone}</option>)}
              </select>
            </ActionForm>}
          </div>}
        </div>
        {connection.incoming && connection.status === "pending" && <div style={{ display: "flex", gap: 8 }}>
          <ActionForm action={respondToParticipantIntro.bind(null, eventSlug, connection.id, true)} label="Accept" pendingLabel="Accepting…" />
          <ActionForm action={respondToParticipantIntro.bind(null, eventSlug, connection.id, false)} label="Decline" pendingLabel="Declining…" secondary />
        </div>}
      </article>)}
    </div>}
  </main>;
}

const card = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: 20, borderRadius: 12, background: "#151519", border: "1px solid #333" } as const;
const muted = { color: "#a1a1aa" } as const;
const contact = { background: "#111", border: "1px solid #3f3f46", borderRadius: 8, padding: 14, lineHeight: 1.8 } as const;
const ask = { marginTop: 10, padding: 12, borderRadius: 8, border: "1px solid #f59e0b", background: "rgba(245,158,11,0.08)" } as const;
