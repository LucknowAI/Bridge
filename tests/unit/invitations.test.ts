import { describe, expect, it, vi } from "vitest";
import { canInvite, invitationState, RESEND_AFTER_MINUTES, type InvitationFacts } from "@/src/domain/participant/invitation";
import { sendInvitations, setAttendeeAccess } from "@/src/application/use-cases/manage-invitations";
import { renderInvitationEmail } from "@match-maker/email";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const facts = (overrides: Partial<InvitationFacts>): InvitationFacts => ({
  revokedAt: null, profileUpdatedAt: null, claimedAt: null, invitedAt: null, inviteError: null, ...overrides,
});
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000);

describe("invitationState", () => {
  it.each([
    [facts({}), "not_invited"],
    [facts({ invitedAt: at(1) }), "invited"],
    [facts({ inviteError: "bounced" }), "failed"],
    [facts({ invitedAt: at(5), claimedAt: at(1) }), "claimed"],
    [facts({ claimedAt: at(5), profileUpdatedAt: at(1) }), "complete"],
    [facts({ profileUpdatedAt: at(5), revokedAt: at(1) }), "removed"],
  ] as const)("%o is %s", (input, state) => {
    expect(invitationState(input)).toBe(state);
  });

  it("allows a resend only after the waiting period, and never after claiming or removal", () => {
    expect(canInvite(facts({}), NOW)).toBe(true);
    expect(canInvite(facts({ invitedAt: at(RESEND_AFTER_MINUTES - 1) }), NOW)).toBe(false);
    expect(canInvite(facts({ invitedAt: at(RESEND_AFTER_MINUTES) }), NOW)).toBe(true);
    expect(canInvite(facts({ claimedAt: at(1) }), NOW)).toBe(false);
    expect(canInvite(facts({ revokedAt: at(1) }), NOW)).toBe(false);
  });
});

function ports(targets: Array<{ attendee_id: string; email: string; name: string | null }>, fail: string[] = []) {
  const events = {
    invitationTargets: vi.fn().mockResolvedValue(targets),
    recordInvitation: vi.fn().mockResolvedValue(undefined),
    setRevoked: vi.fn().mockResolvedValue(true),
    organizerRoles: vi.fn().mockResolvedValue({ event: "owner", organization: null }),
  };
  const notifications = {
    invitation: vi.fn(async ({ email }: { email: string }) => {
      if (fail.includes(email)) throw new Error("Resend rejected the address");
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { events: events as any, notifications: notifications as any, raw: { events, notifications } };
}

const event = { eventId: "event", organizerId: "organizer", eventName: "Summit", organizationName: "Acme", eventUrl: "https://bridge.example.com/e/summit" };

describe("sendInvitations", () => {
  it("sends to every target and records successes and failures separately", async () => {
    const { events, notifications, raw } = ports([
      { attendee_id: "a", email: "a@example.com", name: "A" },
      { attendee_id: "b", email: "bad@example.com", name: null },
    ], ["bad@example.com"]);
    await expect(sendInvitations(event, { events, notifications })).resolves.toEqual({ sent: 1, failed: 1 });
    expect(raw.events.invitationTargets).toHaveBeenCalledWith("event", null, RESEND_AFTER_MINUTES);
    expect(raw.events.recordInvitation).toHaveBeenCalledWith("event", "a", null);
    expect(raw.events.recordInvitation).toHaveBeenCalledWith("event", "b", "Resend rejected the address");
  });

  it("explains why a single resend is refused", async () => {
    const { events, notifications } = ports([]);
    await expect(sendInvitations({ ...event, attendeeId: "a" }, { events, notifications })).rejects.toThrow(/cannot be invited right now/);
  });
});

describe("setAttendeeAccess", () => {
  it("refuses someone not on the roster", async () => {
    const { events, raw } = ports([]);
    raw.events.setRevoked.mockResolvedValue(false);
    await expect(setAttendeeAccess({ eventId: "event", organizerId: "organizer", attendeeId: "x", revoked: true }, { events }))
      .rejects.toThrow(/not on the event roster/);
  });

  it("refuses anyone who is not an organizer of the event", async () => {
    const { events, notifications, raw } = ports([{ attendee_id: "a", email: "a@example.com", name: "A" }]);
    raw.events.organizerRoles.mockResolvedValue({ event: null, organization: null });
    await expect(setAttendeeAccess({ eventId: "event", organizerId: "x", attendeeId: "a", revoked: true }, { events })).rejects.toThrow(/not an organizer/);
    await expect(sendInvitations({ ...event, organizerId: "x" }, { events, notifications })).rejects.toThrow(/not an organizer/);
    expect(raw.events.setRevoked).not.toHaveBeenCalled();
    expect(raw.notifications.invitation).not.toHaveBeenCalled();
  });
});

describe("renderInvitationEmail", () => {
  it("links to the event and escapes names in the HTML", () => {
    const mail = renderInvitationEmail({ name: "<script>", eventName: "Summit & Co", organizationName: "Acme", eventUrl: event.eventUrl });
    expect(mail.subject).toBe("You're invited to Summit & Co on Mr. Bridge");
    expect(mail.text).toContain(event.eventUrl);
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
  });
});
