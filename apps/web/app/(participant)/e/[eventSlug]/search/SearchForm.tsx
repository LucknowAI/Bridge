"use client";

import { useState } from "react";
import { searchEventParticipants } from "../../../../actions/match.actions";
import { requestParticipantIntro } from "../../../../actions/intro.actions";

interface SearchResult {
  id: string;
  name: string;
  designation: string | null;
  domain: string | null;
  aboutMe: string | null;
  yearsOfExperience: number | null;
  score: number;
  reason: string | null;
  mutualInterest: boolean;
}

export default function SearchForm({ eventSlug }: { eventSlug: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResults(await searchEventParticipants(eventSlug, query));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <section>
    <form onSubmit={search} style={{ display: "flex", gap: 10, margin: "24px 0" }}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} required maxLength={300} placeholder="e.g. a product designer interested in climate AI" style={input} />
      <button disabled={busy} style={button}>{busy ? "Searching…" : "Search"}</button>
    </form>
    {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
    {!busy && query && !results.length && !error && <p>No matches yet. Try a broader description.</p>}
    <div style={{ display: "grid", gap: 12 }}>
      {results.map((person) => <article key={person.id} style={card}>
        <div style={{ flex: 1 }}>
          <h2>{person.name}</h2>
          <p style={muted}>{[person.designation, person.domain].filter(Boolean).join(" · ")}</p>
          {person.aboutMe && <p>{person.aboutMe}</p>}
          <p style={{ color: "#fbbf24" }}>{person.reason}</p>
          {person.mutualInterest && <small style={muted}>Your event goals align</small>}
        </div>
        <form action={requestParticipantIntro.bind(null, eventSlug)}>
          <input type="hidden" name="recipientId" value={person.id} />
          <button style={button}>Request intro</button>
        </form>
      </article>)}
    </div>
  </section>;
}

const input = { flex: 1, minWidth: 0, padding: 13, borderRadius: 8, border: "1px solid #3f3f46", background: "#151519", color: "#f4f4f5" } as const;
const button = { border: 0, borderRadius: 8, padding: "12px 16px", background: "#f59e0b", color: "#0a0a0e", fontWeight: 700, cursor: "pointer" } as const;
const card = { display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", padding: 20, borderRadius: 12, background: "#151519", border: "1px solid #333" } as const;
const muted = { color: "#a1a1aa" } as const;
