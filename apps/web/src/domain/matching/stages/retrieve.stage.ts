import { createHash } from "node:crypto";
import type { ParticipantRepository } from "../../../application/ports/participant-repository";
import type { MatchRepository } from "../../../application/ports/match-repository";
import type { CandidateCache } from "../../../application/ports/candidate-cache";
import type { ParticipantProfile } from "../../participant/participant.entity";
import { matchesFilters, NO_FILTERS, type SearchFilters } from "../search-query";
import { computeOnce } from "../../../application/shared-computation";

/** Bump when retrieval semantics change, so cached candidate lists are not reused. */
const RETRIEVAL_VERSION = "r3";

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
    /** Embedding provider/model; vectors from different spaces must not share entries. */
    embeddingSpace?: string;
    /**
     * The viewer's welcomed intents, applied before the limit: filtering
     * afterwards left people with no matches when their nearest neighbours
     * all had intents they do not welcome.
     */
    welcomedIntents?: string[] | null;
    limit?: number;
  }): Promise<ParticipantProfile[]> {
    const limit = input.limit ?? 50;
    const filters = input.filters ?? NO_FILTERS;
    const normalizedQuery = input.query?.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalizedQuery) {
      // Shared across viewers for the same corpus, query, filters and
      // retrieval kind; the ranking that follows is still personal.
      const corpus = await this.participants.corpusRevision(input.eventId);
      const key = createHash("sha256").update(JSON.stringify([
        RETRIEVAL_VERSION, input.eventId, corpus, normalizedQuery, filters.intent, filters.domain?.toLowerCase() ?? null, input.welcomedIntents ?? null,
        input.embedding ? input.embeddingSpace ?? "semantic" : "lexical", limit,
      ])).digest("hex");
      const ids = await computeOnce({
        cache: this.cache,
        key,
        read: () => this.cache.get(key),
        write: (value) => this.cache.set(key, value, 300),
        compute: async () => (await this.participants.listCandidates({
          eventId: input.eventId,
          excludeAttendeeId: null,
          embedding: input.embedding,
          embeddingModel: input.embeddingSpace,
          terms: input.terms,
          filters,
          welcomedIntents: input.welcomedIntents,
          limit,
        })).map((candidate) => candidate.attendeeId),
      });
      // Re-check eligibility and filters: the ids may come from another request.
      const profiles = await this.participants.findCandidatesByIds(input.eventId, ids);
      const byId = new Map(profiles.map((profile) => [profile.attendeeId, profile]));
      return ids.map((id) => byId.get(id))
        .filter((row): row is ParticipantProfile => row !== undefined && row.attendeeId !== input.viewerId && matchesFilters(row, filters));
    }

    return this.participants.listCandidates({
      eventId: input.eventId,
      excludeAttendeeId: input.viewerId,
      embedding: input.embedding,
      embeddingModel: input.embeddingSpace,
      welcomedIntents: input.welcomedIntents,
      limit,
    });
  }
}
