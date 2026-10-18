import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyMatches } from "@/src/application/use-cases/get-my-matches";
import { requireParticipantEvent } from "@/src/lib/auth";
import { refreshParticipantMatches } from "../../../../actions/match.actions";
import { requestParticipantIntro } from "../../../../actions/intro.actions";
import { ActionForm } from "@/components/ui/form";

export default async function MatchesPage({ params, searchParams }: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{ saved?: string; queued?: string }>;
}) {
  const { eventSlug } = await params;
  const notice = await searchParams;
  const { session, event, container } = await requireParticipantEvent(eventSlug, `/e/${eventSlug}/matches`, "viewMatches");
  const viewer = await container.participants.findProfile(event.id, session.attendeeId);
  if (!viewer?.profileComplete) redirect(`/e/${eventSlug}/profile`);
  const matches = await getMyMatches({ eventId: event.id, participantId: session.attendeeId, limit: 12 }, container.matches);

  return <main style={shell}>
    <nav><Link href={`/e/${eventSlug}/profile`}>Edit profile</Link><Link href={`/e/${eventSlug}/search`}>Search attendees</Link><Link href={`/e/${eventSlug}/connections`}>Connections</Link></nav>
    <span style={eyebrow}>YOUR EVENT MATCHES</span>
    <h1>People worth meeting.</h1>
    <p>Matches are ranked for your profile. Contact details stay private until you both accept an introduction.</p>
    {notice.saved && <p role="status" className="notice">Profile saved. Your matches will update in the background.</p>}
    {notice.queued && <p role="status" className="notice">Refresh queued. Reload this page in a minute.</p>}
    {!matches.length ? <section style={empty}>
      <h2>Your first matches are on the way.</h2>
      <p>We are embedding your profile and ranking attendees in the background.</p>
      <ActionForm action={refreshParticipantMatches.bind(null, eventSlug)} label="Refresh matches" pendingLabel="Queuing…" />
    </section> : <div style={list}>
      {matches.map((match, index) => <article key={match.participant.attendeeId} style={card}>
        <div style={rank}>#{index + 1}</div>
        <div style={{ flex: 1 }}>
          <h2>{match.participant.name}</h2>
          <p style={muted}>{[match.participant.designation, match.participant.domain].filter(Boolean).join(" · ")}</p>
          {match.participant.aboutMe && <p>{match.participant.aboutMe}</p>}
          {match.participant.mostImpressiveBuild && <p style={muted}>Built: {match.participant.mostImpressiveBuild}</p>}
          <p style={reason}>{match.reason || "A promising person to meet at this event."}</p>
          <p style={muted}>{match.mutualInterest ? "Your event goals align" : "Suggested for your profile"}</p>
        </div>
        <div style={score}>{Math.round(match.score)}%</div>
        <ActionForm action={requestParticipantIntro.bind(null, eventSlug)} hidden={{ recipientId: match.participant.attendeeId }}
          label="Request intro" pendingLabel="Sending…" />
      </article>)}
    </div>}
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 1000, margin: "0 auto", padding: "36px 24px 80px", color: "#f4f4f5" } as const;
const eyebrow = { color: "#f59e0b", fontSize: 12, letterSpacing: 2, fontWeight: 700 } as const;
const list = { display: "grid", gap: 14, marginTop: 30 } as const;
const card = { display: "flex", alignItems: "flex-start", gap: 18, flexWrap: "wrap", background: "#151519", border: "1px solid #333", borderRadius: 14, padding: 22 } as const;
const rank = { color: "#f59e0b", fontSize: 15, fontWeight: 800 } as const;
const score = { color: "#f59e0b", fontWeight: 800, fontSize: 20 } as const;
const muted = { color: "#a1a1aa", lineHeight: 1.5 } as const;
const reason = { color: "#fbbf24", lineHeight: 1.5 } as const;
const empty = { marginTop: 28, padding: 24, background: "#151519", borderRadius: 12 } as const;
