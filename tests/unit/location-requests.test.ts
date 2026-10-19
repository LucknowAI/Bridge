import { describe, expect, it, vi } from "vitest";
import { currentStatus } from "@/src/domain/connection/location.rules";
import { answerLocation, requestLocation } from "@/src/application/use-cases/location-requests";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const later = (minutes: number) => new Date(NOW + minutes * 60_000);

describe("location request state", () => {
  it.each([
    [{ status: "pending" as const, expiresAt: later(5), zoneExpiresAt: null }, "pending"],
    [{ status: "pending" as const, expiresAt: later(-1), zoneExpiresAt: null }, "expired"],
    [{ status: "answered" as const, expiresAt: later(-60), zoneExpiresAt: later(3) }, "answered"],
    [{ status: "answered" as const, expiresAt: later(-60), zoneExpiresAt: later(-1) }, "expired"],
    [{ status: "declined" as const, expiresAt: later(-60), zoneExpiresAt: null }, "declined"],
  ])("%o is %s", (request, expected) => {
    expect(currentStatus(request, NOW)).toBe(expected);
  });
});

function deps(overrides: { status?: string; member?: boolean; allowed?: boolean; created?: { id: string } | null } = {}) {
  return {
    intros: { findById: vi.fn(async () => ({ id: "intro", requesterId: "a", recipientId: "b", status: overrides.status ?? "accepted" })) },
    participants: { hasEventAccess: vi.fn(async () => overrides.member ?? true) },
    locations: { create: vi.fn(async () => overrides.created === undefined ? { id: "req" } : overrides.created), answer: vi.fn(async () => true), forParticipant: vi.fn() },
    limiter: { consume: vi.fn(async () => overrides.allowed ?? true) },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = (d: ReturnType<typeof deps>, requesterId = "a") => requestLocation({ eventId: "e", introId: "intro", requesterId }, d as any);

describe("requestLocation", () => {
  it("asks the other side of an accepted connection", async () => {
    const d = deps();
    await ask(d);
    expect(d.locations.create).toHaveBeenCalledWith({ eventId: "e", introId: "intro", requesterId: "a", recipientId: "b" });
  });

  it("refuses before acceptance, outside the connection, for removed people, over the limit, or while one is open", async () => {
    await expect(ask(deps({ status: "pending" }))).rejects.toThrow(/accepted/);
    await expect(ask(deps(), "stranger")).rejects.toThrow(/does not belong/);
    await expect(ask(deps({ member: false }))).rejects.toThrow(/no longer part/);
    await expect(ask(deps({ allowed: false }))).rejects.toThrow(/this hour/);
    await expect(ask(deps({ created: null }))).rejects.toThrow(/already asked/);
  });
});

describe("answerLocation", () => {
  it("accepts only the event's zones, and declining needs none", async () => {
    const d = deps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const answer = (zone: string | null) => answerLocation({ eventId: "e", requestId: "req", recipientId: "b", zone, allowedZones: ["Cafe"] }, d as any);
    await expect(answer("Rooftop")).rejects.toThrow(/configured/);
    await answer("Cafe");
    await answer(null);
    expect(d.locations.answer).toHaveBeenCalledTimes(2);
  });
});
