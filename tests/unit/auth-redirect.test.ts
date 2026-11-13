import { describe, expect, it } from "vitest";
import { loginErrorPath, postLoginPath, safeReturnTo } from "../../apps/web/lib/safe-return-to";

describe("post-login destinations", () => {
  it.each(["/login", "/login?returnTo=%2Fe%2Fdemo", "/login/", "/login#form"])("never returns to the login page: %s", (value) => {
    expect(postLoginPath(value)).toBe("/");
  });

  it("keeps ordinary destinations, including look-alike paths", () => {
    expect(postLoginPath("/e/demo/matches")).toBe("/e/demo/matches");
    expect(postLoginPath("/loginhelp")).toBe("/loginhelp");
  });

  it("builds an error URL that keeps the destination", () => {
    expect(loginErrorPath("unregistered", "/e/demo/profile")).toBe("/login?error=unregistered&returnTo=%2Fe%2Fdemo%2Fprofile");
  });

  it("omits an empty, external, or looping destination from the error URL", () => {
    expect(loginErrorPath("provider")).toBe("/login?error=provider");
    expect(loginErrorPath("provider", "https://outside.example")).toBe("/login?error=provider");
    expect(loginErrorPath("provider", "/login")).toBe("/login?error=provider");
  });
});

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
