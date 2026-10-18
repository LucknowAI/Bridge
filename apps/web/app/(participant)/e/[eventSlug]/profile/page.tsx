import Link from "next/link";
import SignOutButton from "@/components/ui/SignOutButton";
import { notFound } from "next/navigation";
import { saveParticipantProfile } from "../../../../actions/participant.actions";
import { requireParticipantEvent } from "@/src/lib/auth";
import ProfileForm from "@/components/participant/ProfileForm";

export default async function ProfilePage({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const { session, event, container } = await requireParticipantEvent(eventSlug, `/e/${eventSlug}/profile`, "saveProfile");
  const profile = await container.participants.findProfile(event.id, session.attendeeId);
  if (!profile) notFound();
  const intents = event.intents?.length ? event.intents : ["NETWORKING"];
  const zones = event.zones ?? [];

  return <main style={shell}>
    <nav><Link href={`/e/${eventSlug}`}>← {event.name}</Link><Link href={`/e/${eventSlug}/connections`}>Connections</Link><SignOutButton /></nav>
    <span style={eyebrow}>PARTICIPANT PROFILE</span>
    <h1>Make your next introduction count.</h1>
    <p>Confirm the profile other attendees will see, then set what you want from this event.</p>
    <ProfileForm action={saveParticipantProfile.bind(null, eventSlug)} intents={intents} zones={zones} profile={{
      name: profile.name, designation: profile.designation, domain: profile.domain, aboutMe: profile.aboutMe,
      selfDescription: profile.selfDescription, mostImpressiveBuild: profile.mostImpressiveBuild,
      yearsOfExperience: profile.yearsOfExperience, interests: profile.interests, intent: profile.intent, venueZone: profile.venueZone,
    }} />
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 820, margin: "0 auto", padding: "36px 24px 80px", color: "#f4f4f5" } as const;
const eyebrow = { color: "#f59e0b", fontSize: 12, letterSpacing: 2, fontWeight: 700 } as const;
