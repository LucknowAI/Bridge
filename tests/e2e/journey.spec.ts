/**
 * The documented journey, in order: an organizer sets up an event and
 * imports the roster; invited attendees sign in and complete profiles; the
 * worker matches them; search finds people; an intro is requested and
 * accepted; contacts appear only then; a venue question is asked and
 * answered; a third attendee sees none of it; closing the event freezes it.
 */
import { expect, test, type Page } from "@playwright/test";
import { ORG, ORGANIZER, RUN, createEvent, phone, requestCode, rosterFile, signIn } from "./support";

const SLUG = `e2e-${RUN}`;
const people = {
  alice: { name: "Alice E2E", designation: "ML Engineer", domain: "Artificial Intelligence", about: "I build retrieval systems and LLM evaluation tooling for startups.", interests: "AI, search, startups", intent: "NETWORKING" },
  bob: { name: "Bob E2E", designation: "Product Designer", domain: "Design", about: "Designing AI assistants for climate and health teams.", interests: "AI, design, climate", intent: "NETWORKING" },
  carol: { name: "Carol E2E", designation: "Founder", domain: "Artificial Intelligence", about: "Founder hiring engineers for an AI search startup.", interests: "AI, hiring, search", intent: "HIRING" },
};
type Person = keyof typeof people;
const email = (key: Person | "stranger") => `e2e-${key}-${RUN}@example.com`;

test.describe.configure({ mode: "serial" });

test.describe("organizer to meeting", () => {
  let organizer: Page;
  const pages = {} as Record<Person, Page>;

  test("organizer creates the event and imports the roster", async ({ browser }) => {
    organizer = await signIn(browser, ORGANIZER, `/orgs/${ORG}/events/new`);
    await createEvent(organizer, SLUG);
    await organizer.goto(`/orgs/${ORG}/events/${SLUG}/roster`);
    const rows = (Object.keys(people) as Person[]).map((key) => ({ Name: people[key].name, Email: email(key), Phone: phone() }));
    await organizer.locator("#field-file").setInputFiles(rosterFile([...rows, { Name: "Broken Row", Email: "not-an-email" }]));
    await organizer.getByRole("button", { name: "Import roster" }).click();
    const status = organizer.getByRole("status").first();
    await expect(status).toContainText("Added 3 attendee");
    await expect(status).toContainText("Skipped 1 row");
  });

  test("an uninvited e-mail cannot sign in", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    expect((await requestCode(page, email("stranger"), `/e/${SLUG}/profile`)).outcome).toBe("unregistered");
  });

  test("invited attendees sign in and complete their profiles", async ({ browser }) => {
    for (const key of Object.keys(people) as Person[]) {
      const page = pages[key] = await signIn(browser, email(key), `/e/${SLUG}/profile`);
      const person = people[key];
      await page.getByLabel("Role or designation").fill(person.designation);
      await page.getByLabel("Professional domain").fill(person.domain);
      await page.getByLabel("About you").fill(person.about);
      await page.getByLabel("Years of experience").fill("5");
      await page.getByLabel("Interests").fill(person.interests);
      await page.getByLabel("What are you looking for?").selectOption(person.intent);
      await page.getByLabel("Where can people find you?").selectOption("Main hall");
      await page.getByRole("button", { name: /Save profile/ }).click();
      await page.waitForURL(/\/matches\?saved=1/);
    }
  });

  test("the worker matches the first person to save without a manual refresh", async () => {
    const alice = pages.alice;
    await expect(async () => {
      await alice.goto(`/e/${SLUG}/matches`);
      await expect(alice.locator("article", { hasText: people.bob.name }).getByRole("button", { name: "Request intro" })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 45_000, intervals: [1500] });
  });

  test("search finds others and never the searcher", async () => {
    const alice = pages.alice;
    await alice.goto(`/e/${SLUG}/search`);
    await alice.getByLabel("Describe who you are looking for").fill("designer working on climate");
    await alice.getByRole("button", { name: "Search" }).click();
    const results = alice.locator("article");
    await expect(results.filter({ hasText: people.bob.name })).toHaveCount(1);
    await expect(results.filter({ hasText: people.alice.name })).toHaveCount(0);
  });

  test("an intro reveals contacts only after the recipient accepts", async () => {
    const { alice, bob } = pages;
    await alice.goto(`/e/${SLUG}/matches`);
    await alice.locator("article", { hasText: people.bob.name }).getByRole("button", { name: "Request intro" }).click();
    await alice.waitForURL(/connections\?requested=1/);
    await expect(alice.locator("main")).not.toContainText(email("bob"));

    await bob.goto(`/e/${SLUG}/connections`);
    await bob.getByRole("button", { name: "Accept" }).first().click();
    await bob.waitForLoadState("networkidle");
    await alice.goto(`/e/${SLUG}/connections`);
    await expect(alice.locator("main")).toContainText(email("bob"));
  });

  test("a venue question is answered voluntarily and only the asker sees the zone", async () => {
    const { alice, bob, carol } = pages;
    await alice.getByRole("button", { name: "Ask where they are" }).click();
    await alice.waitForURL(/asked=1/);
    await expect(alice.locator("main")).toContainText("Waiting for a reply");

    await bob.goto(`/e/${SLUG}/connections`);
    await expect(bob.locator("main")).toContainText(`${people.alice.name} is asking where you are`);
    await bob.getByLabel("Your venue zone").first().selectOption("Cafe");
    await bob.getByRole("button", { name: `Share with ${people.alice.name}` }).click();
    await bob.waitForURL(/replied=1/);

    await alice.goto(`/e/${SLUG}/connections`);
    await expect(alice.locator("main")).toContainText("Replied: at Cafe");
    await carol.goto(`/e/${SLUG}/connections`);
    const carolView = carol.locator("main");
    for (const hidden of [email("alice"), email("bob"), "Cafe"]) await expect(carolView).not.toContainText(hidden);
  });

  test("analytics counts the accepted intro", async () => {
    await organizer.goto(`/orgs/${ORG}/events/${SLUG}/analytics`);
    await expect(organizer.locator("main")).toContainText(/Accepted introductions\s*1/);
  });

  test("closing the event keeps matches readable and stops changes", async () => {
    await organizer.goto(`/orgs/${ORG}/events/${SLUG}`);
    await organizer.getByLabel("Registration status").selectOption("closed");
    await organizer.getByRole("button", { name: "Save event configuration" }).click();
    await expect(organizer.getByText("Event configuration saved")).toBeVisible();

    const { alice } = pages;
    await alice.goto(`/e/${SLUG}/matches`);
    await expect(alice.locator("main")).toContainText("has closed");
    await expect(alice.locator("main")).toContainText(people.bob.name);
    await expect(alice.getByRole("button", { name: "Request intro" })).toHaveCount(0);
    await alice.goto(`/e/${SLUG}/profile`);
    await expect(alice).toHaveURL(new RegExp(`/e/${SLUG}$`));
  });
});
