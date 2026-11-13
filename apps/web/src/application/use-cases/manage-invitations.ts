import { RESEND_AFTER_MINUTES } from "../../domain/participant/invitation";
import type { EventRepository } from "../ports/event-repository";
import type { NotificationPort } from "../ports/notification";
import { authorizeOrganizer } from "./manage-event";
import type { AuditLog } from "../ports/audit-log";

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
  dependencies: { events: EventRepository; notifications: NotificationPort; audit?: AuditLog }
): Promise<InvitationResult> {
  await authorizeOrganizer(dependencies.events, input.eventId, input.organizerId, "invite");
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
  await dependencies.audit?.record({
    eventId: input.eventId, actorId: input.organizerId, action: "invitations.sent",
    subjectId: input.attendeeId ?? null, details: { ...result, resend: Boolean(input.attendeeId) },
  });
  return result;
}

/**
 * Removes or restores one attendee's access. Removal takes effect on their
 * next request (existing sessions included) and drops them from matching and
 * everyone's results; their history stays for the organizer.
 */
export async function setAttendeeAccess(
  input: { eventId: string; organizerId: string; attendeeId: string; revoked: boolean },
  dependencies: { events: EventRepository; audit?: AuditLog }
): Promise<void> {
  await authorizeOrganizer(dependencies.events, input.eventId, input.organizerId, "manageAccess");
  if (!(await dependencies.events.setRevoked(input.eventId, input.attendeeId, input.revoked))) {
    throw new Error("This attendee is not on the event roster");
  }
  await dependencies.audit?.record({
    eventId: input.eventId, actorId: input.organizerId, action: input.revoked ? "access.removed" : "access.restored", subjectId: input.attendeeId,
  });
}
