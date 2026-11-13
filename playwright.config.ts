import { defineConfig } from "@playwright/test";

/**
 * Browser acceptance suite (tests/e2e). It drives an already running app and
 * worker, started with EMAIL_DEV_FALLBACK=true and their output written to
 * E2E_WEB_LOG, which is where the tests read sign-in codes:
 *
 *   E2E_BASE_URL=http://localhost:3000 npx playwright test
 *
 * Set E2E_BROWSER_CHANNEL=chrome to use an installed Chrome instead of the
 * bundled Chromium (`npx playwright install chromium`).
 */
export default defineConfig({
  testDir: "tests/e2e",
  // The journey is one story told in order; parallel runs would share an event.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  outputDir: "test-results/e2e",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
