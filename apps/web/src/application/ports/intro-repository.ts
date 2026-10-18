import type { IntroRequest, IntroStatus } from "../../domain/connection/intro-request.entity";

export interface IntroRepository {
  create(input: { eventId: string; requesterId: string; recipientId: string; message?: string | null }): Promise<IntroRequest>;
  findById(eventId: string, introId: string): Promise<IntroRequest | null>;
  respond(eventId: string, introId: string, actorId: string, status: Extract<IntroStatus, "accepted" | "declined">): Promise<IntroRequest>;
  /** Requests in either direction between two people. */
  findBetween(eventId: string, a: string, b: string): Promise<IntroRequest[]>;
  countPendingOutgoing(eventId: string, requesterId: string): Promise<number>;
  /** The participant's requests, excluding those with someone removed from the event. */
  listForParticipant(eventId: string, participantId: string): Promise<IntroRequest[]>;
  getRevealedContacts(eventId: string, participantId: string): Promise<Array<{ intro: IntroRequest; contact: { id: string; name: string; email: string | null; phone: string | null; venueZone: string | null } }>>;
}
