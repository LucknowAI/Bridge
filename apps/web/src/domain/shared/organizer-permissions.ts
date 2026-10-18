/**
 * What each organizer role may do with an event. Organization owners and
 * admins manage every event in their organization; on a single event, owners
 * and admins configure it and control its roster, while an "organizer" runs
 * it day to day (view, invite, start matching).
 */
export type OrganizerRole = "owner" | "admin" | "organizer";

export type OrganizerAction = "view" | "invite" | "computeMatches" | "configure" | "importRoster" | "manageAccess";

export interface OrganizerRoles {
  event: OrganizerRole | null;
  organization: OrganizerRole | null;
}

const DAY_TO_DAY: readonly OrganizerAction[] = ["view", "invite", "computeMatches"];

const isManager = (role: OrganizerRole | null) => role === "owner" || role === "admin";

export function organizerCan(roles: OrganizerRoles, action: OrganizerAction): boolean {
  if (isManager(roles.organization)) return true;
  if (!roles.event) return false;
  return DAY_TO_DAY.includes(action) || isManager(roles.event);
}

/** Any member of an organization may create an event, and becomes its owner. */
export function canCreateEvent(organizationRole: OrganizerRole | null): boolean {
  return organizationRole !== null;
}

const LABELS: Record<OrganizerAction, string> = {
  view: "view this event",
  invite: "send invitations",
  computeMatches: "start matching",
  configure: "change this event's settings",
  importRoster: "import attendees",
  manageAccess: "remove or restore attendees",
};

export function assertOrganizerCan(roles: OrganizerRoles, action: OrganizerAction): void {
  if (organizerCan(roles, action)) return;
  throw new Error(roles.event || roles.organization
    ? `Only event owners and admins can ${LABELS[action]}.`
    : "You are not an organizer for this event");
}
