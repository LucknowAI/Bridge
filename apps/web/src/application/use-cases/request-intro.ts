import type { IntroRepository } from "../ports/intro-repository";
import type { ParticipantRepository } from "../ports/participant-repository";
import type { NotificationPort } from "../ports/notification";

export async function requestIntro(
  input: { eventId: string; requesterId: string; recipientId: string; message?: string | null; eventName?: string },
  dependencies: { participants: ParticipantRepository; intros: IntroRepository; notifications?: NotificationPort }
) {
  if (!(await dependencies.participants.hasEventAccess(input.eventId, input.requesterId))) throw new Error("You are not registered for this event");
  if (!(await dependencies.participants.hasEventAccess(input.eventId, input.recipientId))) throw new Error("This participant is not in the event");
  const [requester, recipient] = await Promise.all([
    dependencies.participants.findProfile(input.eventId, input.requesterId),
    dependencies.participants.findProfile(input.eventId, input.recipientId),
  ]);
  if (!requester || !recipient || !recipient.visible || !recipient.profileComplete) throw new Error("This participant is unavailable");
  const intro = await dependencies.intros.create(input);
  if (recipient.email && dependencies.notifications) {
    await dependencies.notifications.introRequested({
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      requesterName: requester.name,
      eventName: input.eventName ?? "your event",
      introId: intro.id,
    }).catch((error) => console.warn("[intro] notification failed", error));
  }
  return intro;
}
