import { describe, expect, it } from "vitest";
import { assertOrganizerCan, canCreateEvent, organizerCan, type OrganizerAction, type OrganizerRole } from "@/src/domain/shared/organizer-permissions";

const ACTIONS: OrganizerAction[] = ["view", "invite", "computeMatches", "configure", "importRoster", "manageAccess"];
type Row = [string, OrganizerRole | null, OrganizerRole | null, OrganizerAction[]];

const POLICY: Row[] = [
  ["organization owner", null, "owner", ACTIONS],
  ["organization admin", null, "admin", ACTIONS],
  ["organization organizer without an event role", null, "organizer", []],
  ["event owner", "owner", "organizer", ACTIONS],
  ["event admin", "admin", null, ACTIONS],
  ["event organizer", "organizer", "organizer", ["view", "invite", "computeMatches"]],
  ["nobody", null, null, []],
];

describe("organizer permissions", () => {
  it.each(POLICY)("%s", (_label, event, organization, allowed) => {
    for (const action of ACTIONS) {
      expect(organizerCan({ event, organization }, action), action).toBe(allowed.includes(action));
    }
  });

  it("lets any organization member create events", () => {
    expect(canCreateEvent("organizer")).toBe(true);
    expect(canCreateEvent(null)).toBe(false);
  });

  it("explains a refusal by role", () => {
    expect(() => assertOrganizerCan({ event: "organizer", organization: null }, "importRoster")).toThrow("Only event owners and admins can import attendees.");
    expect(() => assertOrganizerCan({ event: null, organization: null }, "view")).toThrow("You are not an organizer for this event");
  });
});
