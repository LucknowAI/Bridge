import type { LocationRequestView } from "../../domain/connection/location.rules";

export interface LocationRepository {
  /** Creates a pending request and queues its notification in one transaction; null when one is already open. */
  create(input: { eventId: string; introId: string; requesterId: string; recipientId: string }): Promise<{ id: string } | null>;
  /**
   * Answers an open request addressed to `recipientId` with a zone, or
   * declines it (zone null), and queues the notice to the asker. False when
   * there is no such open request.
   */
  answer(input: { eventId: string; requestId: string; recipientId: string; zone: string | null }): Promise<boolean>;
  /** The latest request per connection and direction involving the participant. */
  forParticipant(eventId: string, participantId: string): Promise<LocationRequestView[]>;
}
