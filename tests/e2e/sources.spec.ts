import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { addFeedCredential } from "./support/api";
import { FAKE_OIDC_PORT } from "./support/fake-oidc-port";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Plan M1.5-M1.6: add sources, refresh on demand with live progress, run
// history, readable failures; feeds can refresh again straight away.

function sourceCard(page: Page, name: string) {
  return page.getByTestId("source").filter({ has: page.getByRole("heading", { name }) });
}

async function addFeedSource(page: Page, name: string, credLabel: string, category: string) {
  const form = page.getByRole("form", { name: "Add a source" });
  await form.getByLabel("Type").selectOption("ical");
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Calendar link").selectOption({ label: credLabel });
  await form.getByLabel("Default category").selectOption(category);
  await form.getByRole("button", { name: "Add source" }).click();
  await expect(sourceCard(page, name)).toBeVisible();
}

test("a feed source syncs on demand, shows its history, and can refresh again straight away", async ({
  page,
  context,
}, testInfo) => {
  const name = `Soccer ${testInfo.project.name} ${Date.now()}`;
  await signInAs(context, OWNER);
  await addFeedCredential(context, `${name} link`, "team.ics");
  await page.goto("/settings/sources");
  await addFeedSource(page, name, `${name} link`, "soccer");

  const card = sourceCard(page, name);
  await expect(card).toContainText("Not synced yet");
  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(card).toContainText("3 added, 0 changed, 0 cancelled", { timeout: 30_000 });
  await expect(card).toContainText("OK");

  // SYNC-5: feeds aren't held to the hourly limit; the re-run changes nothing.
  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(card).toContainText("0 added, 0 changed, 0 cancelled", { timeout: 30_000 });
  await expect(card).not.toContainText("The next refresh is possible after");
  await card.getByRole("button", { name: "History" }).click();
  await expect(card.getByRole("table").locator("tbody tr")).toHaveCount(2);
  await expect(card.getByRole("table")).toContainText("3 / 0 / 0");
  await expect(card.getByRole("table")).toContainText("0 / 0 / 0");
});

test("a school's public key dates page becomes school events and closure banners (SCH-2, CAL-7)", async ({
  page,
  context,
}, testInfo) => {
  const name = `School dates ${testInfo.project.name} ${Date.now()}`;
  await signInAs(context, OWNER);
  await page.goto("/settings/sources");
  const form = page.getByRole("form", { name: "Add a source" });
  await form.getByLabel("Type").selectOption("school_dates");
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form
    .getByLabel("Link of the school's key dates page")
    .fill(`http://127.0.0.1:${FAKE_OIDC_PORT}/school/calendar`);
  await form.getByLabel("Leave out items containing").fill("Sr. School Only, AP Exams");
  await expect(form.getByLabel("Default category")).toHaveValue("school_class");
  await expect(form.getByLabel(/^Rules/)).toHaveValue(/school closed = school_closure/);
  await form.getByRole("button", { name: "Add source" }).click();

  const card = sourceCard(page, name);
  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(card).toContainText("9 added, 0 changed, 0 cancelled", { timeout: 30_000 });

  // Winter break: a banner on every day, and the first day back as a school event.
  await page.goto("/?view=timeGridWeek&date=2030-12-30");
  await expect(page.locator(".hub-closure-bg").first()).toBeVisible();
  await page.goto("/?view=timeGridWeek&date=2031-01-06");
  await expect(
    page.getByTestId("cal-event").filter({ hasText: "First Day of Classes after Winter Break" }).first(),
  ).toBeVisible();
});

test("a failing source shows a red status with the reason in plain language (SYNC-4)", async ({
  page,
  context,
}, testInfo) => {
  const name = `Hockey ${testInfo.project.name} ${Date.now()}`;
  await signInAs(context, OWNER);
  await addFeedCredential(context, `${name} link`, "missing.ics");
  await page.goto("/settings/sources");
  await addFeedSource(page, name, `${name} link`, "hockey");
  const card = sourceCard(page, name);
  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(card.getByTestId("source-error")).toHaveText(
    "The calendar link no longer works. Copy a fresh link from the site.",
    { timeout: 30_000 },
  );
  await expect(card).toContainText("Failed");

  // SYNC-5: a failed run doesn't start the hour's wait; History follows along.
  await expect(card).not.toContainText("The next refresh is possible after");
  await card.getByRole("button", { name: "History" }).click();
  await expect(card.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(card.getByRole("table").locator("tbody tr")).toHaveCount(2, { timeout: 30_000 });
  await expect(card.getByRole("table").locator("tbody tr").first()).toContainText("failed (manual)", {
    timeout: 30_000,
  });
});

test("the household Google calendar can be chosen and synced (SRC-1)", async ({
  page,
  context,
}, testInfo) => {
  const account = `household-${testInfo.project.name}@example.test`;
  const name = `Household ${testInfo.project.name} ${Date.now()}`;
  await signInAs(context, OWNER);
  await page.goto("/settings/accounts");
  await page
    .getByRole("region", { name: "Google" })
    .getByRole("link", { name: /Connect Google account|Reconnect Google/ })
    .click();
  await page.getByRole("link", { name: account }).click();
  await expect(page).toHaveURL(/\/settings\/accounts$/);

  await page.goto("/settings/sources");
  const form = page.getByRole("form", { name: "Add a source" });
  await form.getByLabel("Type").selectOption("google_calendar");
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Google account").selectOption({ label: `Google (${account})` });
  await form.getByRole("combobox", { name: "Calendar", exact: true }).selectOption({ label: "Family" });
  await expect(form.getByLabel(/Rules/)).toHaveValue(/swim = swimming/);
  await form.getByRole("button", { name: "Add source" }).click();

  const card = sourceCard(page, name);
  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(card).toContainText("2 added, 0 changed, 0 cancelled", { timeout: 30_000 });
});
