import { expect, test, type Page } from "@playwright/test";
import { addFeedCredential } from "./support/api";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Plan M1.5-M1.6: add sources, refresh on demand with live progress, run
// history, readable failures, one run per hour.

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

test("a feed source syncs on demand, shows its history, and a second refresh is refused", async ({
  page,
  context,
}, testInfo) => {
  const name = `Soccer ${testInfo.project.name} ${Date.now()}`;
  await signInAs(context, OWNER);
  await addFeedCredential(context, `${name} link`, "team.ics");
  await page.goto("/sources");
  await addFeedSource(page, name, `${name} link`, "soccer");

  const card = sourceCard(page, name);
  await expect(card).toContainText("Not synced yet");
  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(card).toContainText("3 added, 0 changed, 0 cancelled", { timeout: 30_000 });
  await expect(card).toContainText("OK");

  // SYNC-2/5: a second refresh within the hour doesn't start another run.
  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText(/Synced recently/)).toBeVisible();
  await card.getByRole("button", { name: "History" }).click();
  await expect(card.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await expect(card.getByRole("table")).toContainText("succeeded (manual)");
  await expect(card.getByRole("table")).toContainText("3 / 0 / 0");
});

test("a failing source shows a red status with the reason in plain language (SYNC-4)", async ({
  page,
  context,
}, testInfo) => {
  const name = `Hockey ${testInfo.project.name} ${Date.now()}`;
  await signInAs(context, OWNER);
  await addFeedCredential(context, `${name} link`, "missing.ics");
  await page.goto("/sources");
  await addFeedSource(page, name, `${name} link`, "hockey");
  const card = sourceCard(page, name);
  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(card.getByTestId("source-error")).toHaveText(
    "The calendar link no longer works. Copy a fresh link from the site.",
    { timeout: 30_000 },
  );
  await expect(card).toContainText("Failed");
});

test("the household Google calendar can be chosen and synced (SRC-1)", async ({
  page,
  context,
}, testInfo) => {
  const account = `household-${testInfo.project.name}@example.test`;
  const name = `Household ${testInfo.project.name} ${Date.now()}`;
  await signInAs(context, OWNER);
  await page.goto("/accounts");
  await page
    .getByRole("region", { name: "Google" })
    .getByRole("link", { name: /Connect Google account|Reconnect Google/ })
    .click();
  await page.getByRole("link", { name: account }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  await page.goto("/sources");
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
