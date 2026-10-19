import { Intent } from "../participant/intent";
import { profileText, type ParticipantProfile } from "../participant/participant.entity";
import { ValidationError } from "../shared/validation";
import { cosineSimilarity } from "./scorers/scorer";

/**
 * What a search means. The query decides who is relevant; the searcher's own
 * profile decides who is compatible. The two are scored separately and then
 * combined, so the same query ranks differently for different people.
 */
export interface SearchFilters {
  intent: Intent | null;
  /** One of the domains present among the event's participants. */
  domain: string | null;
}

export const NO_FILTERS: SearchFilters = { intent: null, domain: null };

/** Share of the final search score that comes from the query; the rest is personal compatibility. */
export const QUERY_WEIGHT = 0.6;

const MAX_TERMS = 12;
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have", "i", "in", "into", "is", "it",
  "looking", "me", "my", "of", "on", "or", "people", "person", "someone", "somebody", "the", "their", "they", "to",
  "want", "who", "with", "working", "works", "someone's", "interested", "like", "find", "need", "about",
]);

/** Meaningful lowercase words from a query, used for lexical retrieval and relevance. */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length > 1 && !STOPWORDS.has(word)))].slice(0, MAX_TERMS);
}

/** Validates filters against what the event offers; unknown values are rejected, not ignored. */
export function normalizeFilters(
  raw: { intent?: string | null; domain?: string | null },
  allowed: { intents: string[]; domains: string[] }
): SearchFilters {
  const intent = raw.intent?.trim() || null;
  if (intent && (!allowed.intents.includes(intent) || !Object.values(Intent).includes(intent as Intent))) {
    throw new ValidationError("intent", "Choose an intent offered by this event");
  }
  const wanted = raw.domain?.trim().toLowerCase() || null;
  const domain = wanted ? allowed.domains.find((value) => value.toLowerCase() === wanted) ?? null : null;
  if (wanted && !domain) throw new ValidationError("domain", "Choose a domain from the list");
  return { intent: intent as Intent | null, domain };
}

export function matchesFilters(profile: ParticipantProfile, filters: SearchFilters): boolean {
  if (filters.intent && profile.intent !== filters.intent) return false;
  if (filters.domain && profile.domain?.toLowerCase() !== filters.domain.toLowerCase()) return false;
  return true;
}

/** Fraction of query terms that start a word of the candidate's profile (0–1). */
export function lexicalRelevance(terms: string[], profile: ParticipantProfile): number {
  if (!terms.length) return 0;
  const words = profileText(profile).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const found = terms.filter((term) => words.some((word) => word.startsWith(term)));
  return found.length / terms.length;
}

/** How well a candidate answers the query: semantic when both vectors exist, otherwise lexical. */
export function queryRelevance(terms: string[], queryEmbedding: number[] | null, profile: ParticipantProfile, queryModel?: string): number {
  const comparable = queryModel === undefined || profile.embeddingModel === undefined || profile.embeddingModel === queryModel;
  const semantic = comparable ? cosineSimilarity(queryEmbedding, profile.embedding) : 0;
  return semantic > 0 ? semantic : lexicalRelevance(terms, profile);
}

/** Final search score (0–100) from query relevance (0–1) and personal compatibility (0–100). */
export function searchScore(relevance: number, personal: number): number {
  return Math.round(QUERY_WEIGHT * relevance * 100 + (1 - QUERY_WEIGHT) * personal);
}

/** Postgres to_tsquery text matching any term as a prefix; terms are already letters and digits only. */
export function lexicalTsQuery(terms: string[]): string | null {
  const safe = terms.map((term) => term.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  return safe.length ? safe.map((term) => `${term}:*`).join(" | ") : null;
}
