import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { saveParticipantProfile } from "../../../../actions/participant.actions";
import { requireParticipantEvent } from "@/src/lib/auth";

export default async function ProfilePage({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const { session, event, container } = await requireParticipantEvent(eventSlug, `/e/${eventSlug}/profile`);
  if (event.status !== "open") notFound();
  const profile = await container.participants.findProfile(event.id, session.attendeeId);
  if (!profile) notFound();
  const intents = event.intents?.length ? event.intents : ["NETWORKING"];
  const zones = event.zones ?? [];

  return <main style={shell}>
    <nav><Link href={`/e/${eventSlug}`}>← {event.name}</Link><Link href={`/e/${eventSlug}/connections`}>Connections</Link></nav>
    <span style={eyebrow}>PARTICIPANT PROFILE</span>
    <h1>Make your next introduction count.</h1>
    <p>Confirm the profile other attendees will see, then set what you want from this event.</p>
    <form action={async (formData) => {
      "use server";
      await saveParticipantProfile(eventSlug, formData);
      redirect(`/e/${eventSlug}/matches`);
    }} style={form}>
      <label>Name<input value={profile.name} readOnly /></label>
      <label>Role or designation<input name="designation" defaultValue={profile.designation ?? ""} required /></label>
      <label>Professional domain<input name="domain" defaultValue={profile.domain ?? ""} required /></label>
      <label>About you<textarea name="aboutMe" defaultValue={profile.aboutMe ?? ""} rows={3} required /></label>
      <label>Current focus<textarea name="selfDescription" defaultValue={profile.selfDescription ?? ""} rows={2} /></label>
      <label>Most impressive thing you have built<textarea name="mostImpressiveBuild" defaultValue={profile.mostImpressiveBuild ?? ""} rows={2} /></label>
      <label>Years of experience<input name="yearsOfExperience" type="number" min="0" max="80" defaultValue={profile.yearsOfExperience ?? ""} /></label>
      <label>Interests, separated by commas<input name="interests" defaultValue={profile.interests.join(", ")} placeholder="AI, product, climate" /></label>
      <label>What are you looking for?
        <select name="intent" defaultValue={profile.intent}>
          {intents.map((intent) => <option key={intent} value={intent}>{intent.replaceAll("_", " ").toLowerCase()}</option>)}
        </select>
      </label>
      {zones.length > 0 && <label>Where can people find you?
        <select name="venueZone" defaultValue={profile.venueZone ?? ""}>
          <option value="">Choose a venue zone</option>
          {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </select>
      </label>}
      <button style={button} type="submit">Save profile and find matches</button>
    </form>
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 820, margin: "0 auto", padding: "36px 24px 80px", color: "#f4f4f5" } as const;
const eyebrow = { color: "#f59e0b", fontSize: 12, letterSpacing: 2, fontWeight: 700 } as const;
const form = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16, marginTop: 28 } as const;
const button = { gridColumn: "1 / -1", border: 0, borderRadius: 8, padding: 14, background: "#f59e0b", color: "#0a0a0e", fontWeight: 700, cursor: "pointer" } as const;
