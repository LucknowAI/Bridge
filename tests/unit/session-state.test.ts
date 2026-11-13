import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ accountState: vi.fn(), isUserEnabled: vi.fn() }));
vi.mock("@match-maker/db", () => ({ attendees: { accountState: mocks.accountState } }));
vi.mock("../../packages/auth/src/keycloak", () => ({ isUserEnabled: mocks.isUserEnabled }));

import { isSessionActive } from "../../packages/auth/src/session-state";

const ISSUED = Date.parse("2026-10-19T10:00:00Z");
const session = { sub: "kc-user", email: "a@example.com", name: null, attendeeId: "attendee", method: "email" as const, iat: ISSUED / 1000 };

describe("isSessionActive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountState.mockResolvedValue({ disabled_at: null, sessions_revoked_at: null });
    mocks.isUserEnabled.mockResolvedValue(true);
  });

  it("accepts a session for an active account and Keycloak user", async () => {
    await expect(isSessionActive(session)).resolves.toBe(true);
  });

  it("ends sessions of a deleted or disabled account", async () => {
    mocks.accountState.mockResolvedValue(null);
    await expect(isSessionActive(session)).resolves.toBe(false);
    mocks.accountState.mockResolvedValue({ disabled_at: new Date(), sessions_revoked_at: null });
    await expect(isSessionActive(session)).resolves.toBe(false);
    expect(mocks.isUserEnabled).not.toHaveBeenCalled();
  });

  it("ends sessions issued before a revocation, but not later ones", async () => {
    mocks.accountState.mockResolvedValue({ disabled_at: null, sessions_revoked_at: new Date(ISSUED + 60_000) });
    await expect(isSessionActive(session)).resolves.toBe(false);
    await expect(isSessionActive({ ...session, iat: (ISSUED + 120_000) / 1000 })).resolves.toBe(true);
  });

  it("ends sessions of a user disabled in Keycloak", async () => {
    mocks.isUserEnabled.mockResolvedValue(false);
    await expect(isSessionActive(session)).resolves.toBe(false);
  });
});
