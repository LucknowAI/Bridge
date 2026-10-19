import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests need the docker-compose stack; they skip themselves
    // when DATABASE_URL is absent rather than failing a bare `npm test`.
    // CI sets REQUIRE_SERVICES so that skipping becomes a failure instead.
    globalSetup: ["./tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": resolvePath("./apps/web"),
      "@match-maker/db": resolvePath("./packages/db/src/index.ts"),
      "@match-maker/auth": resolvePath("./packages/auth/src/index.ts"),
      "@match-maker/email": resolvePath("./packages/email/src/index.ts"),
    },
  },
});
