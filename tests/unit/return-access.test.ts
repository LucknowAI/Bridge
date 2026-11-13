import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findByEventSlug: vi.fn(), findBySlug: vi.fn(), isParticipant: vi.fn(), isOrganizer: vi.fn(), hasOrganizationAccess: vi.fn(),
  listForOrganization: vi.fn(),
}));
const accountState = vi.hoisted(() => vi.fn());
vi.mock("@match-maker/db", () => ({ events: mocks, attendees: { accountState } }));

import { canReturnToPath } from "@/lib/session";

describe("canReturnToPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findBySlug.mockResolvedValue(null);
    accountState.mockResolvedValue({ disabled_at: null, sessions_revoked_at: null });
  });

  it("refuses a disabled account on every path", async () => {
    accountState.mockResolvedValue({ disabled_at: new Date(), sessions_revoked_at: new Date() });
    mocks.hasOrganizationAccess.mockResolvedValue(true);
    await expect(canReturnToPath("/orgs/acme/events/new", "member")).resolves.toBe(false);
    await expect(canReturnToPath("/", "member")).resolves.toBe(false);
  });

  it.each(["/orgs/acme/events/new", "/orgs/acme/events", "/orgs/acme/events/"])(
    "lets an organization member sign in to %s", async (path) => {
      mocks.hasOrganizationAccess.mockResolvedValue(true);
      await expect(canReturnToPath(path, "member")).resolves.toBe(true);
      expect(mocks.hasOrganizationAccess).toHaveBeenCalledWith("acme", "member");
      expect(mocks.findBySlug).not.toHaveBeenCalled();
    });

  it("lets an organizer of one event open the event list, but not create events", async () => {
    mocks.hasOrganizationAccess.mockResolvedValue(false);
    mocks.listForOrganization.mockResolvedValue([{ id: "event" }]);
    await expect(canReturnToPath("/orgs/acme/events", "helper")).resolves.toBe(true);
    await expect(canReturnToPath("/orgs/acme/events/new", "helper")).resolves.toBe(false);
  });

  it("refuses someone outside the organization", async () => {
    mocks.hasOrganizationAccess.mockResolvedValue(false);
    await expect(canReturnToPath("/orgs/acme/events/new", "stranger")).resolves.toBe(false);
  });

  it("still checks event organizers for event pages", async () => {
    mocks.findBySlug.mockResolvedValue({ id: "event" });
    mocks.isOrganizer.mockResolvedValue(true);
    await expect(canReturnToPath("/orgs/acme/events/summit/roster", "organizer")).resolves.toBe(true);
    expect(mocks.findBySlug).toHaveBeenCalledWith("acme", "summit");
  });

  it("still checks participants for event pages", async () => {
    mocks.findByEventSlug.mockResolvedValue({ id: "event" });
    mocks.isParticipant.mockResolvedValue(false);
    await expect(canReturnToPath("/e/summit/matches", "outsider")).resolves.toBe(false);
  });
});
