import Link from "next/link";
import SignOutButton from "@/components/ui/SignOutButton";
import { computeEventMatchesAction } from "../../../../../../actions/organizer.actions";
import { requireOrganizerEvent } from "@/src/lib/auth";
import { ActionForm } from "@/components/ui/form";
import { getEventQueueSummary } from "@/src/application/use-cases/get-match-status";
import { eventAllows } from "@/src/domain/shared/event-lifecycle";

const QUEUE_LABELS = [
  ["queued", "Queued"], ["running", "Running"], ["stuck", "Stuck (running over 10 min)"], ["failed", "Failed"], ["done", "Finished"],
] as const;

export default async function MatchingPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
  searchParams: Promise<{ queued?: string }>;
}) {
  const { orgSlug, eventSlug } = await params;
  const query = await searchParams;
  const { event, container } = await requireOrganizerEvent(orgSlug, eventSlug);
  const [analytics, queue] = await Promise.all([
    container.events.analytics(event.id),
    getEventQueueSummary({ eventId: event.id }, container.matchQueue),
  ]);
  const action = computeEventMatchesAction.bind(null, orgSlug, eventSlug);
  return <main style={shell}>
    <nav><Link href={`/orgs/${orgSlug}/events/${eventSlug}`}>← Dashboard</Link><Link href={`/orgs/${orgSlug}/events/${eventSlug}/roster`}>Roster</Link><Link href={`/orgs/${orgSlug}/events/${eventSlug}/analytics`}>Analytics</Link><SignOutButton /></nav>
    <h1>Matching pipeline</h1>
    <p>Embeddings and ranked matches run in the background for profiles already completed.</p>
    {query.queued && <p role="status" className="notice">Queued profile matching for {query.queued} attendee(s).</p>}
    <section style={card}>
      <div><strong>{analytics.profiles}</strong><span> completed profiles</span><br /><strong>{analytics.matches}</strong><span> saved match results</span></div>
      {eventAllows(event.status, "computeMatches")
        ? <ActionForm action={action} label={event.status === "draft" ? "Open registration and compute matches" : "Compute matches"} pendingLabel="Queuing matches…" />
        : <p>This event is closed. Reopen it from the dashboard to compute matches again.</p>}
    </section>
    {event.status === "draft" && <p>Registration is currently draft. Starting matching opens the event to participants.</p>}
    <h2>Queue</h2>
    <p>Where each participant&apos;s latest matching job stands.</p>
    <dl style={grid}>
      {QUEUE_LABELS.map(([key, label]) => <div key={key} style={stat}><dt>{label}</dt><dd style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{queue[key]}</dd></div>)}
    </dl>
    {(queue.failed > 0 || queue.stuck > 0) && <p className="form-alert">Some participants have no fresh matches. &ldquo;Compute matches&rdquo; queues failed and stuck participants again.</p>}
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 900, margin: "0 auto", padding: "36px 24px", color: "#f4f4f5" } as const;
const card = { display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 20, alignItems: "center", padding: 24, background: "#151519", border: "1px solid #333", borderRadius: 12, marginTop: 24 } as const;
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, margin: "16px 0" } as const;
const stat = { display: "grid", gap: 6, padding: 16, borderRadius: 12, background: "#151519", border: "1px solid #333" } as const;
