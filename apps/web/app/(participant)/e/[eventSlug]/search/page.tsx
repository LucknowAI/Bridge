import Link from "next/link";
import SignOutButton from "@/components/ui/SignOutButton";
import { requireParticipantEvent } from "@/src/lib/auth";
import SearchForm from "./SearchForm";

export default async function SearchPage({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const { event, container } = await requireParticipantEvent(eventSlug, `/e/${eventSlug}/search`, "search");
  const domains = await container.participants.listDomains(event.id);
  return <main style={{ minHeight: "100vh", maxWidth: 900, margin: "0 auto", padding: "36px 24px", color: "#f4f4f5" }}>
    <nav><Link href={`/e/${eventSlug}/matches`}>← Matches</Link><Link href={`/e/${eventSlug}/connections`}>Connections</Link><SignOutButton /></nav>
    <h1>Search your event</h1>
    <p>Describe the people, skills, or collaboration you are looking for.</p>
    <SearchForm eventSlug={eventSlug} intents={event.intents} domains={domains} />
  </main>;
}
