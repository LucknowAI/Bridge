import { describe, expect, it } from "vitest";
import { attendees } from "@match-maker/db";

describe("normalizePhone", () => {
  it("assumes +91 for a bare 10-digit number", () => {
    expect(attendees.normalizePhone("9876543210")).toBe("+919876543210");
  });

  it("strips separators before normalising", () => {
    expect(attendees.normalizePhone("98765 43210")).toBe("+919876543210");
    expect(attendees.normalizePhone("98765-43210")).toBe("+919876543210");
    expect(attendees.normalizePhone("(98765) 43210")).toBe("+919876543210");
  });

  it("adds the plus to a 12-digit 91-prefixed number", () => {
    expect(attendees.normalizePhone("919876543210")).toBe("+919876543210");
  });

  it("keeps an already-E.164 number intact", () => {
    expect(attendees.normalizePhone("+919876543210")).toBe("+919876543210");
    expect(attendees.normalizePhone("+14155552671")).toBe("+14155552671");
  });

  it("is idempotent", () => {
    const once = attendees.normalizePhone("9876543210");
    expect(attendees.normalizePhone(once)).toBe(once);
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(attendees.normalizeEmail("  Aarav@Example.COM ")).toBe(
      "aarav@example.com"
    );
  });
});
