import type { ParticipantProfile, ParticipantProfileInput } from "../../domain/participant/participant.entity";
import type { SearchFilters } from "../../domain/matching/search-query";

export interface ParticipantRepository {
  findProfile(eventId: string, attendeeId: string): Promise<ParticipantProfile | null>;
  /** Saves the profile and durably queues the work that reflects it. */
  saveProfile(input: ParticipantProfileInput): Promise<ParticipantProfile>;
  listCandidates(input: {
    eventId: string;
    excludeAttendeeId: string | null;
    embedding?: number[] | null;
    /** Without an embedding, only candidates matching one of these words, best first. */
    terms?: string[];
    filters?: SearchFilters;
    /** Only people with one of these intents (the viewer's welcomed intents); null for all. */
    welcomedIntents?: string[] | null;
    /** The model behind `embedding`; vectors from other models are not ranked against it. */
    embeddingModel?: string | null;
    limit?: number;
  }): Promise<ParticipantProfile[]>;
  /** Changes whenever the event's participants change; part of retrieval cache keys. */
  corpusRevision(eventId: string): Promise<number>;
  /** Domains present among eligible participants, for the search filter. */
  listDomains(eventId: string): Promise<string[]>;
  findCandidatesByIds(eventId: string, ids: string[]): Promise<ParticipantProfile[]>;
  setEmbedding(eventId: string, attendeeId: string, embedding: number[], model: string): Promise<void>;
  /** Writes the embedding only while the profile is still at `revision`; false when it moved on. */
  setEmbeddingAt(eventId: string, attendeeId: string, embedding: number[], revision: number, model: string): Promise<boolean>;
  shareVenueZone(eventId: string, attendeeId: string, zone: string): Promise<void>;
  hasEventAccess(eventId: string, attendeeId: string): Promise<boolean>;
}
