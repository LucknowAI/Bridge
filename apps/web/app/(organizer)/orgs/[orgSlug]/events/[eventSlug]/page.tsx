import Link from "next/link";
import SignOutButton from "@/components/ui/SignOutButton";
import { updateEventAction, updateProfileFormAction } from "../../../../../actions/organizer.actions";
import ProfileFormSettings from "@/components/organizer/ProfileFormSettings";
import { readProfileForm } from "@/src/domain/participant/profile-form";
import { requireOrganizerEvent } from "@/src/lib/auth";
import { EventSetupForm } from "@/components/organizer/EventForms";

export default async function EventDashboardPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
  searchParams: Promise<{ saved?: string; form?: string }>;
}) {
  const { orgSlug, eventSlug } = await params;
  const notice = await searchParams;
  const { event, container, can } = await requireOrganizerEvent(orgSlug, eventSlug);
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
    <SignOutButton /></nav>
    <section style={stats}>
      <Stat label="Registered" value={analytics.roster} />
      <Stat label="Profiles" value={analytics.profiles} />
      <Stat label="Ranked matches" value={analytics.matches} />
      <Stat label="Accepted intros" value={analytics.acceptedIntros} />
    </section>
    <h2>Event setup</h2>
    {notice.saved && <p role="status" className="notice">Event configuration saved.</p>}
    {can("configure") ? <EventSetupForm action={action} event={{
      name: event.name, description: event.description ?? null, status: event.status, intents: event.intents, zones: event.zones,
    }} /> : <p className="empty-state">
      Registration is {event.status}. Only event owners and admins can change this event&apos;s settings.
    </p>}
    {can("configure") && <>
      <h2>Profile form</h2>
      <p>Choose which questions attendees answer, what they are called, and which are required.</p>
      {notice.form && <p role="status" className="notice">Profile form saved. Attendees missing a newly required answer are asked for it next time they open their profile.</p>}
      <ProfileFormSettings action={updateProfileFormAction.bind(null, orgSlug, eventSlug)} form={readProfileForm(event.form_config)} />
    </>}
  </main>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div style={stat}><strong>{value}</strong><span>{label}</span></div>;
}

const shell = { minHeight: "100vh", maxWidth: 1040, margin: "0 auto", padding: "36px 24px 80px", color: "#f4f4f5" } as const;
const stats = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, margin: "28px 0" } as const;
const stat = { display: "grid", gap: 6, background: "#151519", borderRadius: 12, padding: 18, border: "1px solid #333" } as const;
