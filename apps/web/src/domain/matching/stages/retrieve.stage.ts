import { createHash } from "node:crypto";
import type { ParticipantRepository } from "../../../application/ports/participant-repository";
import type { MatchRepository } from "../../../application/ports/match-repository";
import type { CandidateCache } from "../../../application/ports/candidate-cache";
import type { ParticipantProfile } from "../../participant/participant.entity";
import { matchesFilters, NO_FILTERS, type SearchFilters } from "../search-query";

export class RetrieveStage {
  constructor(
    private readonly participants: ParticipantRepository,
    private readonly cache: CandidateCache
  ) {}

  async execute(input: {
    eventId: string;
    viewerId: string;
    embedding: number[] | null;
    query?: string;
    terms?: string[];
    filters?: SearchFilters;
    limit?: number;
  }): Promise<ParticipantProfile[]> {
    const limit = input.limit ?? 50;
    const filters = input.filters ?? NO_FILTERS;
    const normalizedQuery = input.query?.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalizedQuery) {
      // Shared across viewers for the same event, query, filters and retrieval
      // kind; the ranking that follows is still personal.
      const key = createHash("sha256")
        .update(JSON.stringify([input.eventId, normalizedQuery, filters.intent, filters.domain?.toLowerCase() ?? null, input.embedding ? "semantic" : "lexical"]))
        .digest("hex");
      const cachedIds = await this.cache.get(key);
      if (cachedIds) {
        const cached = await this.participants.findCandidatesByIds(input.eventId, cachedIds);
        const byId = new Map(cached.map((profile) => [profile.attendeeId, profile]));
        return cachedIds.map((id) => byId.get(id))
          .filter((row): row is ParticipantProfile => row !== undefined && row.attendeeId !== input.viewerId && matchesFilters(row, filters));
      }

      const candidates = await this.participants.listCandidates({
        eventId: input.eventId,
        excludeAttendeeId: null,
        embedding: input.embedding,
        terms: input.terms,
        filters,
        limit,
      });
      await this.cache.set(key, candidates.map((c) => c.attendeeId), 300);
      return candidates.filter((candidate) => candidate.attendeeId !== input.viewerId && matchesFilters(candidate, filters));
    }

    return this.participants.listCandidates({
      eventId: input.eventId,
      excludeAttendeeId: input.viewerId,
      embedding: input.embedding,
      limit,
    });
  }
}
