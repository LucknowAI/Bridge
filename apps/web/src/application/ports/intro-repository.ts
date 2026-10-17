import type { IntroRequest, IntroStatus } from "../../domain/connection/intro-request.entity";

export interface IntroRepository {
  create(input: { eventId: string; requesterId: string; recipientId: string; message?: string | null }): Promise<IntroRequest>;
  findById(eventId: string, introId: string): Promise<IntroRequest | null>;
  respond(eventId: string, introId: string, actorId: string, status: Extract<IntroStatus, "accepted" | "declined">): Promise<IntroRequest>;
  listForParticipant(eventId: string, participantId: string): Promise<IntroRequest[]>;
  getRevealedContacts(eventId: string, participantId: string): Promise<Array<{ intro: IntroRequest; contact: { id: string; name: string; email: string | null; phone: string | null; venueZone: string | null } }>>;
}
