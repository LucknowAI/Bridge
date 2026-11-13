import type { IntroRequest } from "./intro-request.entity";

/** Contact details are disclosed only after both sides accepted. */
export function mayRevealContact(request: IntroRequest): boolean {
  return request.status === "accepted";
}

/** Limits on introduction requests, per requester and event. */
export const INTRO_LIMITS = {
  perHour: 20,
  pendingOutgoing: 25,
} as const;

/**
 * Whether a new request from `requesterId` may be created, given the requests
 * already existing between the two people (either direction). A decline is
 * final for the event, and a pending request the other way should be
 * answered rather than duplicated.
 */
export function introRequestRefusal(requesterId: string, existing: IntroRequest[]): string | null {
  for (const intro of existing) {
    const mine = intro.requesterId === requesterId;
    if (intro.status === "accepted") return "You are already connected";
    if (mine && intro.status === "pending") return "You already asked to meet them";
    if (mine && intro.status === "declined") return "They declined an earlier request, so you cannot ask again at this event";
    if (!mine && intro.status === "pending") return "They already asked to meet you. Accept their request on your Connections page";
  }
  return null;
}
