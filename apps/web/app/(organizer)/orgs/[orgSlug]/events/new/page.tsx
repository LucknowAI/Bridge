import Link from "next/link";
import SignOutButton from "@/components/ui/SignOutButton";
import { createEventAction } from "../../../../../actions/organizer.actions";
import { requireOrganizationMember } from "@/src/lib/auth";
import { NewEventForm } from "@/components/organizer/EventForms";

export default async function NewEventPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { session, organization, container } = await requireOrganizationMember(orgSlug, `/orgs/${orgSlug}/events/new`);
  const existing = await container.events.listForOrganization(orgSlug, session.attendeeId);
  const create = createEventAction.bind(null, orgSlug);
  return <main style={shell}>
    <Link href={`/orgs/${orgSlug}/events/${existing[0]?.slug ?? "new"}`}>← Organizer</Link>
    <nav><Link href={`/orgs/${orgSlug}/events`}>← Events</Link><SignOutButton /></nav>
    <h1>Create an event</h1>
    <p>Set up a roster, participant profile, and matching flow for {organization.name}.</p>
    <NewEventForm action={create} />
    {existing.length > 0 ? <section><h2>Your events</h2><ul>{existing.map((event) => <li key={event.id}><Link href={`/orgs/${orgSlug}/events/${event.slug}`}>{event.name} · {event.status}</Link></li>)}</ul></section> : <p className="empty-state">No events yet. Your first event will appear here.</p>}
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 760, margin: "0 auto", padding: "40px 24px", color: "#f4f4f5" } as const;
