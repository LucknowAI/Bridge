import { afterEach, describe, expect, it } from "vitest";
import { GET as health } from "../../apps/web/app/api/health/route.js";

describe("/api/health", () => {
  afterEach(() => {
    delete process.env.APP_VERSION;
  });

  it("reports the release tag baked into the image", async () => {
    process.env.APP_VERSION = "a1b2c3d4e5f6";
    const body = await (await health()).json();
    expect(body).toMatchObject({ status: "ok", version: "a1b2c3d4e5f6" });
  });

  it("reports dev outside a release build", async () => {
    expect((await (await health()).json()).version).toBe("dev");
  });
});
