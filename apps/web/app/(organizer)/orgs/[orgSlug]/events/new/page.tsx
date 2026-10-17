import Link from "next/link";
import { createEventAction } from "../../../../../actions/organizer.actions";
import { requireOrganizationMember } from "@/src/lib/auth";

export default async function NewEventPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organization, container } = await requireOrganizationMember(orgSlug, `/orgs/${orgSlug}/events/new`);
  const existing = await container.events.listForOrganization(orgSlug);
  const create = createEventAction.bind(null, orgSlug);
  return <main style={shell}>
    <Link href={`/orgs/${orgSlug}/events/${existing[0]?.slug ?? "new"}`}>← Organizer</Link>
    <h1>Create an event</h1>
    <p>Set up a roster, participant profile, and matching flow for {organization.name}.</p>
    <form action={create} style={form}>
      <label>Event name<input name="name" required maxLength={120} placeholder="AI Community Meetup" /></label>
      <label>URL slug<input name="slug" maxLength={80} placeholder="meetup-2026" /></label>
      <label>Description<textarea name="description" rows={3} /></label>
      <button style={button}>Create event</button>
    </form>
    {existing.length > 0 && <section><h2>Your events</h2><ul>{existing.map((event) => <li key={event.id}><Link href={`/orgs/${orgSlug}/events/${event.slug}`}>{event.name} · {event.status}</Link></li>)}</ul></section>}
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 760, margin: "0 auto", padding: "40px 24px", color: "#f4f4f5" } as const;
const form = { display: "grid", gap: 16, maxWidth: 560, margin: "24px 0" } as const;
const button = { border: 0, borderRadius: 8, padding: 13, background: "#f59e0b", color: "#0a0a0e", fontWeight: 700, cursor: "pointer" } as const;
