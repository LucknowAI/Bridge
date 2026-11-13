import { describe, expect, it } from "vitest";
import { renderLoginEmail } from "@match-maker/email";

const base = {
  name: "Aarav Sharma",
  code: "048213",
  magicLinkUrl: "https://bridge.example.com/auth/callback?token=abc123",
  expiresInMinutes: 10,
};

describe("renderLoginEmail", () => {
  it("carries both redemption methods", () => {
    const { html } = renderLoginEmail(base);
    // The typed code is rendered letter-spaced, so match on the digits it contains.
    expect(html).toContain("0 4 8 2 1 3");
    expect(html).toContain(base.magicLinkUrl);
    expect(html).toContain("Log In");
  });

  it("puts the code in the subject for inbox preview", () => {
    expect(renderLoginEmail(base).subject).toContain("048213");
  });

  it("states the expiry", () => {
    const { html, text } = renderLoginEmail(base);
    expect(html).toContain("10 minutes");
    expect(text).toContain("10 minutes");
  });

  it("greets by name when known, generically when not", () => {
    expect(renderLoginEmail(base).html).toContain("Hi Aarav Sharma,");
    expect(renderLoginEmail({ ...base, name: null }).html).toContain("Hi,");
  });

  it("escapes HTML in the name", () => {
    const { html } = renderLoginEmail({
      ...base,
      name: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("ships a plain-text alternative containing the same code and link", () => {
    const { text } = renderLoginEmail(base);
    expect(text).toContain("048213");
    expect(text).toContain(base.magicLinkUrl);
  });
});
