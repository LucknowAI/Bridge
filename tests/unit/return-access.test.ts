import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findByEventSlug: vi.fn(), findBySlug: vi.fn(), isParticipant: vi.fn(), isOrganizer: vi.fn(), hasOrganizationAccess: vi.fn(),
}));
vi.mock("@match-maker/db", () => ({ events: mocks }));

import { canReturnToPath } from "@/lib/session";

describe("canReturnToPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findBySlug.mockResolvedValue(null);
  });

  it.each(["/orgs/acme/events/new", "/orgs/acme/events", "/orgs/acme/events/"])(
    "lets an organization member sign in to %s", async (path) => {
      mocks.hasOrganizationAccess.mockResolvedValue(true);
      await expect(canReturnToPath(path, "member")).resolves.toBe(true);
      expect(mocks.hasOrganizationAccess).toHaveBeenCalledWith("acme", "member");
      expect(mocks.findBySlug).not.toHaveBeenCalled();
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
