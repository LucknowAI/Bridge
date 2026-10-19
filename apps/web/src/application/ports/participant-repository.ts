import type { ParticipantProfile, ParticipantProfileInput } from "../../domain/participant/participant.entity";
import type { SearchFilters } from "../../domain/matching/search-query";

export interface ParticipantRepository {
  findProfile(eventId: string, attendeeId: string): Promise<ParticipantProfile | null>;
  saveProfile(input: ParticipantProfileInput): Promise<ParticipantProfile>;
  listCandidates(input: {
    eventId: string;
    excludeAttendeeId: string | null;
    embedding?: number[] | null;
    /** Without an embedding, only candidates matching one of these words, best first. */
    terms?: string[];
    filters?: SearchFilters;
    limit?: number;
  }): Promise<ParticipantProfile[]>;
  /** Changes whenever the event's participants change; part of retrieval cache keys. */
  corpusRevision(eventId: string): Promise<number>;
  /** Domains present among eligible participants, for the search filter. */
  listDomains(eventId: string): Promise<string[]>;
  findCandidatesByIds(eventId: string, ids: string[]): Promise<ParticipantProfile[]>;
  setEmbedding(eventId: string, attendeeId: string, embedding: number[]): Promise<void>;
  shareVenueZone(eventId: string, attendeeId: string, zone: string): Promise<void>;
  hasEventAccess(eventId: string, attendeeId: string): Promise<boolean>;
}
