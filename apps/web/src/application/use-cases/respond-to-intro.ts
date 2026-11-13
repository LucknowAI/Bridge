import type { IntroRepository } from "../ports/intro-repository";
import type { ParticipantRepository } from "../ports/participant-repository";
import type { AuditLog } from "../ports/audit-log";

export async function respondToIntro(
  input: { eventId: string; introId: string; actorId: string; accept: boolean; eventName?: string },
  dependencies: { intros: IntroRepository; participants: ParticipantRepository; audit?: AuditLog }
) {
  const existing = await dependencies.intros.findById(input.eventId, input.introId);
  if (!existing) throw new Error("Intro request not found");
  if (input.accept && !(await dependencies.participants.hasEventAccess(input.eventId, existing.requesterId))) {
    throw new Error("This person is no longer part of the event");
  }
  const updated = await dependencies.intros.respond(input.eventId, input.introId, input.actorId, input.accept ? "accepted" : "declined");
  if (updated.status === "accepted") {
    await dependencies.audit?.record({ eventId: input.eventId, actorId: input.actorId, action: "contacts.revealed", subjectId: updated.requesterId });
  }
  return updated;
}
