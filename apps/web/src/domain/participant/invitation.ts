/**
 * Where an invited attendee stands for one event, as the organizer sees it.
 * Removed overrides everything; otherwise the furthest step reached wins.
 */
export type InvitationState = "removed" | "complete" | "claimed" | "invited" | "failed" | "not_invited";

/** A resend for the same attendee is refused until this much time has passed. */
export const RESEND_AFTER_MINUTES = 10;

export interface InvitationFacts {
  revokedAt: Date | null;
  profileUpdatedAt: Date | null;
  claimedAt: Date | null;
  invitedAt: Date | null;
  inviteError: string | null;
}

export function invitationState(facts: InvitationFacts): InvitationState {
  if (facts.revokedAt) return "removed";
  if (facts.profileUpdatedAt) return "complete";
  if (facts.claimedAt) return "claimed";
  if (facts.inviteError) return "failed";
  if (facts.invitedAt) return "invited";
  return "not_invited";
}

/** Whether the organizer can send this attendee an invitation now. */
export function canInvite(facts: InvitationFacts, now = Date.now()): boolean {
  const state = invitationState(facts);
  if (state === "removed" || state === "claimed" || state === "complete") return false;
  return !facts.invitedAt || now - facts.invitedAt.getTime() >= RESEND_AFTER_MINUTES * 60_000;
}
