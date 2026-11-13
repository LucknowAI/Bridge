/**
 * Helpers for the browser suite: sign in through the real login page with
 * the code the app logged (EMAIL_DEV_FALLBACK), build roster sheets, and
 * create events. Every run uses its own event and attendees.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import pg from "pg";
import * as XLSX from "xlsx";
import "dotenv/config";

export const ORG = process.env.E2E_ORGANIZATION ?? "ai-community-lucknow";
export const ORGANIZER = process.env.E2E_ORGANIZER_EMAIL ?? "organizer@example.com";
const WEB_LOG = process.env.E2E_WEB_LOG ?? "node_modules/.cache/e2e/web.log";

export const RUN = Date.now().toString(36);
export const phone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;

export async function db<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** Byte offset of the end of the app log; mail logged after it is new. */
export const logOffset = () => statSync(WEB_LOG).size;

/** The newest login e-mail the app logged for `email` after byte offset `since`. */
export async function loginMail(email: string, since: number): Promise<{ code: string; link: string | null }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const log = readFileSync(WEB_LOG).subarray(since).toString("utf8");
    const at = log.lastIndexOf(`To:    ${email}`);
    const code = at >= 0 ? log.slice(at).match(/Code:\s+(\d{6})/)?.[1] : undefined;
    if (code) return { code, link: log.slice(at).match(/Link:\s+(\S+)/)?.[1] ?? null };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no login e-mail was logged for ${email}; is the app writing to ${WEB_LOG}?`);
}

/** Sends a code from the login page; resolves with what the page answered. */
export async function requestCode(page: Page, email: string, returnTo: string): Promise<{ outcome: "sent" | "unregistered"; since: number }> {
  await db(`delete from login_challenges where email = $1`, [email]);
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByRole("button", { name: /Email Address/ }).click();
  await page.locator('input[type="email"]').fill(email);
  const since = logOffset();
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  const outcome = await Promise.race([
    page.getByText("Check your inbox").waitFor().then(() => "sent" as const),
    page.getByText(/not on the attendee list/i).waitFor().then(() => "unregistered" as const),
  ]);
  return { outcome, since };
}

export async function enterCode(page: Page, email: string, since: number, returnTo: string) {
  const { code } = await loginMail(email, since);
  await page.getByLabel("Six-digit email verification code").fill(code);
  await page.getByRole("button", { name: "Verify & Sign In" }).click();
  await page.waitForURL((url) => url.pathname === returnTo.split("?")[0]);
}

/** A new browser session signed in as `email`, on `returnTo`. */
export async function signIn(browser: Browser, email: string, returnTo: string, options: BrowserContextOptions = {}): Promise<Page> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const { outcome, since } = await requestCode(page, email, returnTo);
  expect(outcome, `${email} should be invited`).toBe("sent");
  await enterCode(page, email, since, returnTo);
  return page;
}

export function rosterFile(rows: Array<Record<string, string>>): string {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Roster");
  const file = join(tmpdir(), `mr-bridge-roster-${RUN}-${rows.length}.xlsx`);
  writeFileSync(file, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  return file;
}

export async function createEvent(page: Page, slug: string, zones = "Main hall, Cafe") {
  await page.goto(`/orgs/${ORG}/events/new`);
  await page.getByLabel("Event name").fill(`E2E ${slug}`);
  await page.getByLabel("URL slug").fill(slug);
  await page.getByRole("button", { name: "Create event" }).click();
  await page.waitForURL(`**/orgs/${ORG}/events/${slug}`);
  await page.getByLabel("Supported intents").fill("NETWORKING, HIRING, MENTORING");
  await page.getByLabel("Venue zones").fill(zones);
  await page.getByLabel("Registration status").selectOption("open");
  await page.getByRole("button", { name: "Save event configuration" }).click();
  await expect(page.getByText("Event configuration saved")).toBeVisible();
}

/** How far the page scrolls sideways; more than a pixel means a broken phone layout. */
export const sidewaysOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
