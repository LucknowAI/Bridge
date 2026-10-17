import type { ParticipantProfile, ParticipantProfileInput } from "../../domain/participant/participant.entity";

export interface ParticipantRepository {
  findProfile(eventId: string, attendeeId: string): Promise<ParticipantProfile | null>;
  saveProfile(input: ParticipantProfileInput): Promise<ParticipantProfile>;
  listCandidates(input: {
    eventId: string;
    excludeAttendeeId: string | null;
    embedding?: number[] | null;
    limit?: number;
  }): Promise<ParticipantProfile[]>;
  findCandidatesByIds(eventId: string, ids: string[]): Promise<ParticipantProfile[]>;
  setEmbedding(eventId: string, attendeeId: string, embedding: number[]): Promise<void>;
  shareVenueZone(eventId: string, attendeeId: string, zone: string): Promise<void>;
  hasEventAccess(eventId: string, attendeeId: string): Promise<boolean>;
}
