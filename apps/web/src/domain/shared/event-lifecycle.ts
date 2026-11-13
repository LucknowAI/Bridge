/**
 * What each event status permits. Every participant action, the organizer's
 * compute button, and the background worker check this one table, so draft,
 * open, and closed events behave the same way everywhere.
 */
export type EventStatus = "draft" | "open" | "closed";

export type EventAction =
  | "saveProfile"
  | "search"
  | "refreshMatches"
  | "requestIntro"
  | "shareZone"
  | "viewMatches"
  | "respondToIntro"
  | "computeMatches"
  | "processJob";

const ALLOWED: Record<EventAction, readonly EventStatus[]> = {
  saveProfile: ["open"],
  search: ["open"],
  refreshMatches: ["open"],
  requestIntro: ["open"],
  shareZone: ["open"],
  // After an event closes, people keep their results and can answer requests already sent.
  viewMatches: ["open", "closed"],
  respondToIntro: ["open", "closed"],
  // Computing on a draft opens it first; a closed event is never silently reopened.
  computeMatches: ["draft", "open"],
  processJob: ["open"],
};

const LABELS: Record<EventAction, string> = {
  saveProfile: "Profile editing",
  search: "Search",
  refreshMatches: "Refreshing matches",
  requestIntro: "Requesting introductions",
  shareZone: "Sharing your venue zone",
  viewMatches: "Matches",
  respondToIntro: "Replying to introductions",
  computeMatches: "Computing matches",
  processJob: "Matching",
};

export function eventAllows(status: EventStatus, action: EventAction): boolean {
  return ALLOWED[action].includes(status);
}

export function assertEventAllows(status: EventStatus, action: EventAction): void {
  if (eventAllows(status, action)) return;
  const label = LABELS[action];
  throw new Error(status === "draft"
    ? `${label} becomes available when the event opens.`
    : `${label} ended when the event closed.`);
}
