import { RESEND_AFTER_MINUTES } from "../../domain/participant/invitation";
import type { EventRepository } from "../ports/event-repository";
import type { NotificationPort } from "../ports/notification";

export interface InvitationResult {
  sent: number;
  failed: number;
}

/**
 * E-mails invitations: to one attendee (a resend), or to everyone on the
 * roster never invited. Each attempt is recorded, so a failed delivery shows
 * up on the roster instead of disappearing.
 */
export async function sendInvitations(
  input: { eventId: string; organizerId: string; eventName: string; organizationName: string; eventUrl: string; attendeeId?: string },
  dependencies: { events: EventRepository; notifications: NotificationPort }
): Promise<InvitationResult> {
  await assertOrganizer(input.eventId, input.organizerId, dependencies.events);
  const targets = await dependencies.events.invitationTargets(input.eventId, input.attendeeId ?? null, RESEND_AFTER_MINUTES);
  if (input.attendeeId && !targets.length) {
    throw new Error(`This attendee cannot be invited right now: they may have signed in already, been removed, or been invited in the last ${RESEND_AFTER_MINUTES} minutes.`);
  }
  const result: InvitationResult = { sent: 0, failed: 0 };
  for (const target of targets) {
    try {
      await dependencies.notifications.invitation({
        email: target.email,
        name: target.name,
        eventName: input.eventName,
        organizationName: input.organizationName,
        eventUrl: input.eventUrl,
      });
      await dependencies.events.recordInvitation(input.eventId, target.attendee_id, null);
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await dependencies.events.recordInvitation(input.eventId, target.attendee_id, message.slice(0, 300));
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Removes or restores one attendee's access. Removal takes effect on their
 * next request (existing sessions included) and drops them from matching and
 * everyone's results; their history stays for the organizer.
 */
export async function setAttendeeAccess(
  input: { eventId: string; organizerId: string; attendeeId: string; revoked: boolean },
  dependencies: { events: EventRepository }
): Promise<void> {
  await assertOrganizer(input.eventId, input.organizerId, dependencies.events);
  if (!(await dependencies.events.setRevoked(input.eventId, input.attendeeId, input.revoked))) {
    throw new Error("This attendee is not on the event roster");
  }
}

async function assertOrganizer(eventId: string, organizerId: string, events: EventRepository): Promise<void> {
  if (!(await events.isOrganizer(eventId, organizerId))) throw new Error("You are not an organizer for this event");
}
