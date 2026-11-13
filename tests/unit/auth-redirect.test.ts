import { describe, expect, it } from "vitest";
import { safeReturnTo } from "../../apps/web/lib/safe-return-to";

describe("login return destinations", () => {
  it.each([
    undefined, null, 42, "https://outside.example", "//outside.example",
    "/\\outside.example", "/\n/outside.example", "/\t/outside.example", " /e/demo",
  ])("rejects an external or malformed destination: %s", (value) => {
    expect(safeReturnTo(value)).toBe("/");
  });

  it("preserves the event destination and its query", () => {
    expect(safeReturnTo("/e/demo/matches?queued=1#results")).toBe("/e/demo/matches?queued=1#results");
  });

  it("normalizes dot segments before event access is checked", () => {
    expect(safeReturnTo("/other/../e/private-event")).toBe("/e/private-event");
    expect(safeReturnTo("/other/%2e%2e/e/private-event")).toBe("/e/private-event");
  });
});
