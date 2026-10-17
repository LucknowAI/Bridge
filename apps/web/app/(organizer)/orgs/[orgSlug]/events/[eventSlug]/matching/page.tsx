import Link from "next/link";
import { computeEventMatchesAction } from "../../../../../../actions/organizer.actions";
import { requireOrganizerEvent } from "@/src/lib/auth";

export default async function MatchingPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
  searchParams: Promise<{ queued?: string }>;
}) {
  const { orgSlug, eventSlug } = await params;
  const query = await searchParams;
  const { event, container } = await requireOrganizerEvent(orgSlug, eventSlug);
  const analytics = await container.events.analytics(event.id);
  const action = computeEventMatchesAction.bind(null, orgSlug, eventSlug);
  return <main style={shell}>
    <nav><Link href={`/orgs/${orgSlug}/events/${eventSlug}`}>← Dashboard</Link><Link href={`/orgs/${orgSlug}/events/${eventSlug}/roster`}>Roster</Link><Link href={`/orgs/${orgSlug}/events/${eventSlug}/analytics`}>Analytics</Link></nav>
    <h1>Matching pipeline</h1>
    <p>Embeddings and ranked matches run in the background for profiles already completed.</p>
    {query.queued && <p role="status" style={{ color: "#86efac" }}>Queued profile matching for {query.queued} attendee(s).</p>}
    <section style={card}>
      <div><strong>{analytics.profiles}</strong><span> completed profiles</span><br /><strong>{analytics.matches}</strong><span> saved match results</span></div>
      <form action={action}><button style={button}>Open registration and compute matches</button></form>
    </section>
    {event.status !== "open" && <p>Registration is currently {event.status}. Starting matching opens the event to participants.</p>}
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 900, margin: "0 auto", padding: "36px 24px", color: "#f4f4f5" } as const;
const card = { display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 20, alignItems: "center", padding: 24, background: "#151519", border: "1px solid #333", borderRadius: 12, marginTop: 24 } as const;
const button = { border: 0, borderRadius: 8, padding: 14, background: "#f59e0b", color: "#0a0a0e", fontWeight: 700, cursor: "pointer" } as const;
