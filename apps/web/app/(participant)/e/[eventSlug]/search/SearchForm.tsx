"use client";

import { useState } from "react";
import { searchEventParticipants } from "../../../../actions/match.actions";
import { requestParticipantIntro } from "../../../../actions/intro.actions";
import { ActionForm } from "@/components/ui/form";
import { LIMITS } from "@/src/domain/shared/validation";

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

const intentLabel = (intent: string) => intent.replaceAll("_", " ").toLowerCase();

export default function SearchForm({ eventSlug, intents, domains }: { eventSlug: string; intents: string[]; domains: string[] }) {
  const [query, setQuery] = useState("");
  const [intent, setIntent] = useState("");
  const [domain, setDomain] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState("");

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await searchEventParticipants(eventSlug, query, { intent: intent || null, domain: domain || null });
      setResults(response.results);
      setError(response.error ?? "");
      setSearched(response.error ? "" : query.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <section>
    <form onSubmit={search} role="search" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "24px 0" }}>
      <label htmlFor="search-query" className="visually-hidden">Describe who you are looking for</label>
      <input id="search-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} required
        maxLength={LIMITS.searchQuery} placeholder="e.g. a product designer interested in climate AI" style={input} />
      <button className="btn" disabled={busy} aria-busy={busy}>{busy ? "Searching…" : "Search"}</button>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, flexBasis: "100%" }}>
        <div style={filterLabel}>
          <label htmlFor="search-intent">Looking for</label>
          <select id="search-intent" value={intent} onChange={(event) => setIntent(event.target.value)} style={select}>
            <option value="">Any goal</option>
            {intents.map((value) => <option key={value} value={value}>{intentLabel(value)}</option>)}
          </select>
        </div>
        {domains.length > 0 && <div style={filterLabel}>
          <label htmlFor="search-domain">Domain</label>
          <select id="search-domain" value={domain} onChange={(event) => setDomain(event.target.value)} style={select}>
            <option value="">Any domain</option>
            {domains.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>}
      </div>
    </form>
    {error && <p role="alert" className="form-alert">{error}</p>}
    <p role="status" className="visually-hidden">{busy ? "Searching" : searched ? `${results.length} results for ${searched}` : ""}</p>
    {!busy && searched && !results.length && !error && <p className="empty-state">No one matched “{searched}”. Try a broader description or different skills.</p>}
    <div style={{ display: "grid", gap: 12 }}>
      {results.map((person) => <article key={person.id} style={card}>
        <div style={{ flex: 1 }}>
          <h2>{person.name}</h2>
          <p style={muted}>{[person.designation, person.domain].filter(Boolean).join(" · ")}</p>
          {person.aboutMe && <p>{person.aboutMe}</p>}
          <p style={{ color: "#fbbf24" }}>{person.reason}</p>
          {person.mutualInterest && <small style={muted}>Likely a strong fit for each other</small>}
        </div>
        <ActionForm action={requestParticipantIntro.bind(null, eventSlug)} hidden={{ recipientId: person.id }} label="Request intro" pendingLabel="Sending…" />
      </article>)}
    </div>
  </section>;
}

const input = { flex: "1 1 240px", minWidth: 0, padding: 13, borderRadius: 8, border: "1px solid #3f3f46", background: "#151519", color: "#f4f4f5" } as const;
const card = { display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", padding: 20, borderRadius: 12, background: "#151519", border: "1px solid #333" } as const;
const muted = { color: "#a1a1aa" } as const;
const filterLabel = { display: "grid", gap: 4, fontSize: 14, color: "#a1a1aa" } as const;
const select = { padding: 10, borderRadius: 8, border: "1px solid #3f3f46", background: "#151519", color: "#f4f4f5", font: "inherit" } as const;
