import type { IntroRepository } from "../ports/intro-repository";
import type { NotificationPort } from "../ports/notification";
import type { ParticipantRepository } from "../ports/participant-repository";

export async function respondToIntro(
  input: { eventId: string; introId: string; actorId: string; accept: boolean; eventName?: string },
  dependencies: { intros: IntroRepository; participants: ParticipantRepository; notifications?: NotificationPort }
) {
  const existing = await dependencies.intros.findById(input.eventId, input.introId);
  if (!existing) throw new Error("Intro request not found");
  if (input.accept && !(await dependencies.participants.hasEventAccess(input.eventId, existing.requesterId))) {
    throw new Error("This person is no longer part of the event");
  }
  const updated = await dependencies.intros.respond(input.eventId, input.introId, input.actorId, input.accept ? "accepted" : "declined");
  if (updated.status === "accepted" && dependencies.notifications) {
    const requester = await dependencies.participants.findProfile(input.eventId, updated.requesterId);
    const recipient = await dependencies.participants.findProfile(input.eventId, updated.recipientId);
    if (requester?.email) {
      await dependencies.notifications.introResponded({
        recipientEmail: requester.email,
        recipientName: requester.name,
        requesterName: recipient?.name ?? "Your connection",
        eventName: input.eventName ?? "your event",
        accepted: true,
      }).catch((error) => console.warn("[intro] notification failed", error));
    }
  }
  return updated;
}
