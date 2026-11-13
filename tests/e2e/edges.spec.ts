/**
 * Sign-in edges and layout: phone lookup still proves e-mail ownership,
 * magic links work once, a tampered cookie leads to a usable login page,
 * signing out ends access, and pages fit a phone screen.
 */
import { devices, expect, test, type Page } from "@playwright/test";
import { ORG, ORGANIZER, RUN, createEvent, enterCode, logOffset, loginMail, phone, rosterFile, sidewaysOverflow, signIn } from "./support";

const SLUG = `e2e-edges-${RUN}`;
const dana = { email: `e2e-dana-${RUN}@example.com`, phone: phone() };
const eli = { email: `e2e-eli-${RUN}@example.com`, phone: phone() };
const PHONE = { ...devices["Pixel 7"] };
delete (PHONE as { defaultBrowserType?: string }).defaultBrowserType;

test.describe.configure({ mode: "serial" });

test.describe("sign-in edges and phone layout", () => {
  let organizer: Page;

  test.beforeAll(async ({ browser }) => {
    organizer = await signIn(browser, ORGANIZER, `/orgs/${ORG}/events/new`, PHONE);
    await createEvent(organizer, SLUG);
    await organizer.goto(`/orgs/${ORG}/events/${SLUG}/roster`);
    await organizer.locator("#field-file").setInputFiles(rosterFile([
      { Name: "Dana Edge", Email: dana.email, Phone: dana.phone },
      { Name: "Eli Edge", Email: eli.email, Phone: eli.phone },
    ]));
    await organizer.getByRole("button", { name: "Import roster" }).click();
    await expect(organizer.getByRole("status").first()).toContainText("Added 2 attendee");
  });

  test("organizer pages fit a phone and offer sign out", async () => {
    for (const path of ["", "/roster", "/matching", "/analytics"]) {
      await organizer.goto(`/orgs/${ORG}/events/${SLUG}${path}`);
      expect(await sidewaysOverflow(organizer), `organizer${path || " dashboard"}`).toBeLessThanOrEqual(1);
      await expect(organizer.getByRole("button", { name: "Sign out" })).toHaveCount(1);
    }
  });

  test("phone sign-in shows only a masked e-mail, then reaches the event", async ({ browser }) => {
    const page = await (await browser.newContext(PHONE)).newPage();
    const returnTo = `/e/${SLUG}/connections`;
    await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    await page.getByRole("button", { name: /Phone Number/ }).click();
    await page.locator('input[type="tel"]').fill(dana.phone);
    const since = logOffset();
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await expect(page.getByText("Check your inbox")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(dana.email);
    await enterCode(page, dana.email, since, returnTo);

    for (const path of ["/connections", "/matches"]) {
      await page.goto(`/e/${SLUG}${path}`);
      expect(await sidewaysOverflow(page), path).toBeLessThanOrEqual(1);
    }

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login**");
    await page.goto(`/e/${SLUG}/connections`);
    await expect(page).toHaveURL(/\/login/);
  });

  test("a magic link signs in once and cannot be reused", async ({ browser, baseURL }) => {
    const page = await (await browser.newContext()).newPage();
    const since = logOffset();
    const response = await page.request.post("/api/auth/otp/request", {
      headers: { "content-type": "application/json", origin: baseURL! },
      data: { email: eli.email, returnTo: `/e/${SLUG}/profile` },
    });
    expect(response.ok()).toBe(true);
    const { link } = await loginMail(eli.email, since);
    const local = link!.replace(/^https?:\/\/[^/]+/, "");
    await page.goto(local);
    await expect(page).toHaveURL(new RegExp(`/e/${SLUG}/profile`));

    const other = await (await browser.newContext()).newPage();
    await other.goto(local);
    await expect(other).toHaveURL(/\/login/);
  });

  test("a tampered session cookie leads to a usable login page", async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    await context.addCookies([{ name: "mb_session", value: "tampered.value", url: baseURL! }]);
    const page = await context.newPage();
    await page.goto(`/e/${SLUG}/matches`);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: /Email Address/ })).toBeVisible();
  });
});
