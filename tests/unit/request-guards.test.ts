import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ consume: vi.fn() }));
vi.mock("../../apps/web/src/infrastructure/cache/postgres-rate-limiter", () => ({
  PostgresRateLimiter: class { consume = mocks.consume; },
}));

import { clientIp } from "@/lib/session";
import { IP_LIMITS, limitByIp, requireJson } from "@/lib/rate-limit";
import { isSameOrigin, middleware } from "../../apps/web/middleware";
import { POST as lookup } from "../../apps/web/app/api/auth/lookup/route.js";

const withForwarded = (value?: string) =>
  new Request("http://localhost:3000/api/auth/otp/request", { headers: value ? { "x-forwarded-for": value } : {} });

describe("clientIp", () => {
  it("trusts no header when no proxy is configured", () => {
    expect(clientIp(withForwarded("203.0.113.9"), 0)).toBeNull();
  });

  it("takes the address the ALB appended, not a forged first entry", () => {
    expect(clientIp(withForwarded("1.1.1.1"), 1)).toBe("1.1.1.1");
    expect(clientIp(withForwarded("6.6.6.6, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientIp(withForwarded("6.6.6.6, 203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
  });

  it("returns null when the request skipped the proxies", () => {
    expect(clientIp(withForwarded(), 1)).toBeNull();
    expect(clientIp(withForwarded("203.0.113.9"), 2)).toBeNull();
  });
});

describe("limitByIp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRUSTED_PROXY_HOPS = "1";
  });

  it("counts each IP separately per endpoint", async () => {
    mocks.consume.mockResolvedValue(true);
    expect(await limitByIp(withForwarded("203.0.113.9"), "otpVerify")).toBeNull();
    expect(mocks.consume).toHaveBeenCalledWith("ip:otpVerify:203.0.113.9", IP_LIMITS.otpVerify.limit, IP_LIMITS.otpVerify.windowSeconds);
  });

  it("answers 429 with Retry-After once the limit is passed", async () => {
    mocks.consume.mockResolvedValue(false);
    const response = await limitByIp(withForwarded("203.0.113.9"), "otpRequest");
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe(String(IP_LIMITS.otpRequest.windowSeconds));
  });

  it("is skipped when the client IP is unknown", async () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(await limitByIp(withForwarded("203.0.113.9"), "otpRequest")).toBeNull();
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});

describe("requireJson", () => {
  it("refuses a form or text body", () => {
    const post = (type: string) => new Request("http://localhost:3000/api/x", { method: "POST", headers: { "content-type": type } });
    expect(requireJson(post("text/plain"))?.status).toBe(415);
    expect(requireJson(post("application/x-www-form-urlencoded"))?.status).toBe(415);
    expect(requireJson(post("application/json; charset=utf-8"))).toBeNull();
  });
});

describe("same-origin check", () => {
  const post = (headers: Record<string, string>, method = "POST") =>
    new NextRequest("http://localhost:3000/api/auth/otp/verify", { method, headers });

  it.each([
    ["the app's own origin", { origin: "http://localhost:3000" }, true],
    ["the configured APP_BASE_URL", { origin: "https://bridge.example.com" }, true],
    ["a referer from the app", { referer: "http://localhost:3000/login" }, true],
    ["a non-browser client with neither header", {}, true],
    ["another site", { origin: "https://evil.example" }, false],
    ["an opaque origin", { origin: "null" }, false],
    ["another site's referer", { referer: "https://evil.example/page" }, false],
  ])("treats %s correctly", (_label, headers, allowed) => {
    process.env.APP_BASE_URL = "https://bridge.example.com";
    expect(isSameOrigin(post(headers))).toBe(allowed);
  });

  it("blocks cross-site API mutations but not reads", async () => {
    expect((await middleware(post({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await middleware(post({ origin: "https://evil.example" }, "GET"))).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("retired roster lookup", () => {
  it("answers 410 without reading the roster", async () => {
    expect((await lookup()).status).toBe(410);
  });
});
