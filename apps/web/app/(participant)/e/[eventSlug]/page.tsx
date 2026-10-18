import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getContainer } from "@/src/composition/container";
import { signOutCurrentUser } from "../../../actions/participant.actions";
import { eventAllows } from "@/src/domain/shared/event-lifecycle";

export default async function EventLandingPage({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const container = getContainer();
  const event = await container.events.findByEventSlug(eventSlug);
  if (!event) notFound();

  const session = await getSession();
  const returnTo = `/e/${eventSlug}/profile`;
  if (!session) {
    return <main style={shell}>
      <span style={eyebrow}>MR. BRIDGE · EVENT NETWORKING</span>
      <h1>{event.name}</h1>
      <p>{event.description || "Meet the right people at this event."}</p>
      <p>{event.status === "open" ? "Join the registered attendees and build your event profile." : `Registration is ${event.status}.`}</p>
      {event.status === "open" && <Link style={button} href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Claim your attendee login</Link>}
    </main>;
  }

  if (!(await container.participants.hasEventAccess(event.id, session.attendeeId))) {
    return <main style={shell}>
      <span style={eyebrow}>MR. BRIDGE · EVENT NETWORKING</span>
      <h1>{event.name}</h1>
      <p>This account is not on the event roster. Ask the organizer to add your registered e-mail.</p>
      <form action={signOutCurrentUser}><button style={button} type="submit">Sign out</button></form>
    </main>;
  }

  const profile = await container.participants.findProfile(event.id, session.attendeeId);
  if (event.status === "open") redirect(profile?.profileComplete ? `/e/${eventSlug}/matches` : `/e/${eventSlug}/profile`);

  return <main style={shell}>
    <span style={eyebrow}>{event.status.toUpperCase()}</span>
    <h1>{event.name}</h1>
    {eventAllows(event.status, "viewMatches")
      ? <>
        <p>This event has closed. Your matches and accepted connections stay available, and you can still reply to pending introductions.</p>
        <Link style={button} href={`/e/${eventSlug}/matches`}>View your matches</Link>{" "}
        <Link style={button} href={`/e/${eventSlug}/connections`}>Connections</Link>
      </>
      : <p>This event has not opened yet. Come back when the organizer opens registration.</p>}
    <form action={signOutCurrentUser} style={{ marginTop: 28 }}><button className="link-button" type="submit">Sign out</button></form>
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 760, margin: "0 auto", padding: "12vh 24px", color: "#f4f4f5", background: "#0a0a0e" } as const;
const eyebrow = { color: "#f59e0b", fontSize: 12, letterSpacing: 2, fontWeight: 700 } as const;
const button = { display: "inline-block", marginTop: 20, border: 0, borderRadius: 8, padding: "13px 18px", background: "#f59e0b", color: "#0a0a0e", fontWeight: 700, textDecoration: "none", cursor: "pointer" } as const;
