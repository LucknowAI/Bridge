import type { IntroRepository } from "../ports/intro-repository";
import type { ParticipantRepository } from "../ports/participant-repository";
import type { NotificationPort } from "../ports/notification";
import { boundedText, LIMITS } from "../../domain/shared/validation";
import { INTRO_LIMITS, introRequestRefusal } from "../../domain/connection/connection.rules";
import type { RateLimiter } from "../ports/rate-limiter";

export async function requestIntro(
  input: { eventId: string; requesterId: string; recipientId: string; message?: string | null; eventName?: string },
  dependencies: { participants: ParticipantRepository; intros: IntroRepository; notifications?: NotificationPort; limiter?: RateLimiter }
) {
  if (input.requesterId === input.recipientId) throw new Error("You cannot request an intro to yourself");
  if (!(await dependencies.participants.hasEventAccess(input.eventId, input.requesterId))) throw new Error("You are not registered for this event");
  if (!(await dependencies.participants.hasEventAccess(input.eventId, input.recipientId))) throw new Error("This participant is not in the event");
  const [requester, recipient] = await Promise.all([
    dependencies.participants.findProfile(input.eventId, input.requesterId),
    dependencies.participants.findProfile(input.eventId, input.recipientId),
  ]);
  if (!requester || !recipient || !recipient.visible || !recipient.profileComplete) throw new Error("This participant is unavailable");
  const message = boundedText(input.message, "message", "Message", LIMITS.introMessage);
  const refusal = introRequestRefusal(input.requesterId, await dependencies.intros.findBetween(input.eventId, input.requesterId, input.recipientId));
  if (refusal) throw new Error(refusal);
  if (await dependencies.intros.countPendingOutgoing(input.eventId, input.requesterId) >= INTRO_LIMITS.pendingOutgoing) {
    throw new Error(`You have ${INTRO_LIMITS.pendingOutgoing} requests waiting for an answer. Wait for replies before asking more people.`);
  }
  if (dependencies.limiter && !(await dependencies.limiter.consume(`intro:${input.eventId}:${input.requesterId}`, INTRO_LIMITS.perHour, 3600))) {
    throw new Error("You have sent many introduction requests this hour. Please try again later.");
  }
  const intro = await dependencies.intros.create({ ...input, message });
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
