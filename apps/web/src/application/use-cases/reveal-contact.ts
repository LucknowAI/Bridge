import { mayRevealContact } from "../../domain/connection/connection.rules";
import type { IntroRepository } from "../ports/intro-repository";

/** Contact data is looked up only when the accepted intro is viewed. */
export async function revealContact(input: { eventId: string; participantId: string }, intros: IntroRepository) {
  const rows = await intros.getRevealedContacts(input.eventId, input.participantId);
  return rows.filter((row) => mayRevealContact(row.intro));
}
