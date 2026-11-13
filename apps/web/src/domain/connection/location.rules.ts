/**
 * "Where are you?" between two accepted connections. Asking is a request,
 * not tracking: the other person decides whether to reply with a venue zone.
 * The reply is visible only to the person who asked.
 */
export const LOCATION_RULES = {
  /** An unanswered request stops showing after this long. */
  requestExpiresMinutes: 30,
  /** A shared zone is shown to the asker for this long. */
  replyVisibleMinutes: 15,
  /** Requests one person may send per event and hour. */
  perHour: 10,
} as const;

export type LocationRequestStatus = "pending" | "answered" | "declined" | "expired";

export interface LocationRequestView {
  id: string;
  introId: string;
  direction: "incoming" | "outgoing";
  status: LocationRequestStatus;
  /** Only for the asker, while the reply is fresh. */
  zone: string | null;
  createdAt: Date;
  zoneExpiresAt: Date | null;
}

/** The state a request is in now: pending requests and shared zones expire. */
export function currentStatus(request: { status: "pending" | "answered" | "declined"; expiresAt: Date; zoneExpiresAt: Date | null }, now = Date.now()): LocationRequestStatus {
  if (request.status === "pending") return request.expiresAt.getTime() > now ? "pending" : "expired";
  if (request.status === "answered") return request.zoneExpiresAt && request.zoneExpiresAt.getTime() > now ? "answered" : "expired";
  return "declined";
}
