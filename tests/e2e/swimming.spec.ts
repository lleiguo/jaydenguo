import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { apiSend } from "./support/api";
import { FAKE_COMMIT_LOGIN } from "./support/fake-commit";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Plan M2.3-M2.7: Commit Swimming syncs (from a local fake of the site, with
// the scrubbed fixture), meets and results show PBs and changes, the PB
// table, progression chart and estimate, and a correction survives the
// next sync. The sync tests share one source, so they run in order, on the
// desktop project only (PBs are worked out across every source's swims).

async function lastRun(context: BrowserContext, sourceId: string) {
  const { sources } = await apiSend(context, "GET", "/api/v1/sources");
  return sources.find((s: { id: string }) => s.id === sourceId)?.lastRun ?? null;
}

async function syncNow(context: BrowserContext, sourceId: string) {
  const before = (await lastRun(context, sourceId))?.id ?? null;
  await apiSend(context, "POST", `/api/v1/sources/${sourceId}/refresh`);
  await expect
    .poll(
      async () => {
        const run = await lastRun(context, sourceId);
        return run && run.id !== before ? run.status : "waiting";
      },
      { timeout: 60_000 },
    )
    .toBe("succeeded");
}

// SYNC-5 allows one run an hour; move the last one back so the test can
// sync again now.
async function backdateRuns(sourceId: string) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(
      "update sync_runs set started_at = started_at - interval '2 hours' where source_id = $1",
      [sourceId],
    );
  } finally {
    await pool.end();
  }
}

function row(page: Page, event: string) {
  return page.getByTestId("swim-result").filter({ has: page.getByRole("link", { name: event }) });
}

test.describe("swimming", () => {
  test.describe.configure({ mode: "serial" });
  let sourceId: string;

  test.beforeEach(async ({ context }, info) => {
    test.skip(info.project.name !== "desktop", "sync tests run once, on desktop");
    await signInAs(context, OWNER);
  });

  test("a Commit Swimming source syncs meets, entries and results (M2.3)", async ({ page, context }) => {
    const cred = await apiSend(context, "POST", "/api/v1/credentials", {
      kind: "password",
      provider: "commit_swim",
      label: `Commit ${Date.now()}`,
      username: FAKE_COMMIT_LOGIN.username,
      secret: FAKE_COMMIT_LOGIN.password,
    });
    const source = await apiSend(context, "POST", "/api/v1/sources", {
      kind: "commit_swim",
      name: `Swimming ${Date.now()}`,
      credentialId: cred.id,
      categoryMapping: { default: "swimming" },
    });
    sourceId = source.id;
    await syncNow(context, sourceId);

    // Meets are on the calendar as all-day swimming events (SWM-2).
    const calendar = await apiSend(
      context,
      "GET",
      "/api/v1/events?from=2024-05-18T00:00:00Z&to=2024-05-21T00:00:00Z",
    );
    expect(calendar.events).toContainEqual(
      expect.objectContaining({ title: "Fixture Time Trial 30", category: "swimming", allDay: true }),
    );

    await page.goto("/swimming");
    const meet = page.getByTestId("meet").filter({ hasText: "Fixture Time Trial 30" });
    await expect(meet).toContainText("3 swims · ★ 2 PBs");
    const pb = page.getByTestId("pb-row").filter({ has: page.getByRole("link", { name: "50 Breast" }) });
    await expect(pb).toContainText("1:08.70");
    await expect(pb).toContainText("2024-05-19");
  });

  test("a meet's results show PBs and the change from the previous best (M2.4)", async ({ page }) => {
    await page.goto("/swimming");
    await page.getByRole("link", { name: "Fixture Time Trial 30" }).first().click();
    await expect(page.getByRole("heading", { name: "Fixture Time Trial 30" })).toBeVisible();
    await expect(row(page, "50 Breast SCM")).toContainText("★ PB");
    await expect(row(page, "50 Breast SCM")).toContainText("−1.02");
    await expect(row(page, "200 IM SCM")).toContainText("4:31.35");
    await expect(row(page, "200 IM SCM")).toContainText("+3.38");
    await expect(row(page, "200 IM SCM")).not.toContainText("PB");
    await row(page, "200 IM SCM").getByText("Splits").click();
    await expect(row(page, "200 IM SCM")).toContainText("200 m: 4:31.35 (58.92)");
    await expect(page.getByRole("heading", { name: "Entered events" })).toBeVisible();
  });

  test("an event shows its progression and an estimate, under the strict CSP (M2.5, M2.6)", async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    await page.goto("/swimming/events/50-breast-SCM");
    await expect(page.getByRole("heading", { name: "50 Breast SCM" })).toBeVisible();
    const chart = page.getByRole("img", { name: /50 Breast SCM: 7 swims, with an estimate/ });
    await expect(chart).toBeVisible();
    const forecast = page.getByTestId("forecast");
    await expect(forecast.getByRole("heading", { name: "Estimate" })).toBeVisible();
    await expect(forecast).toContainText("In 6 months");
    await expect(forecast).toContainText("In 12 months");
    // Keyboard reaches each swim; its details show in the chart.
    await page
      .getByRole("img", { name: /50 Breast SCM/ })
      .locator("circle[tabindex='0']")
      .first()
      .focus();
    await expect(chart).toContainText("1:26.08");
    // Other courses never appear here.
    await page.goto("/swimming/events/50-breast-LCM");
    await expect(page.getByText("No timed swims yet.")).toBeVisible();
    expect(violations).toEqual([]);
  });

  test("a correction survives the next sync and is flagged when the source disagrees (M2.7)", async ({
    page,
    context,
  }) => {
    await page.goto("/swimming");
    await page.getByRole("link", { name: "Fixture Time Trial 30" }).first().click();
    const breast = row(page, "50 Breast SCM");
    await breast.getByRole("button", { name: "Edit" }).click();
    const form = page.getByRole("form", { name: /Correct 50 Breast SCM/ });
    await form.getByLabel("Time").fill("1:08.50");
    await form.getByRole("button", { name: "Save correction" }).click();
    await expect(breast).toContainText("1:08.50");
    await expect(breast).toContainText("Corrected by you");
    await expect(breast.getByTestId("source-disagrees")).toContainText("Commit Swimming says 1:08.70");

    await backdateRuns(sourceId);
    await syncNow(context, sourceId);
    await page.reload();
    await expect(breast).toContainText("1:08.50");
    await expect(breast.getByTestId("source-disagrees")).toContainText("Commit Swimming says 1:08.70");

    // Going back to the source's time clears the flag.
    await breast.getByRole("button", { name: "Edit" }).click();
    await form.getByRole("button", { name: "Use Commit's 1:08.70" }).click();
    await expect(breast).toContainText("1:08.70");
    await expect(breast.getByTestId("source-disagrees")).toHaveCount(0);
  });

  test("a swim added by hand shows up with a PB flag (SWM-7, SYNC-6)", async ({ page }) => {
    await page.goto("/swimming");
    await page.getByRole("button", { name: "+ Add a swim" }).click();
    const form = page.getByRole("form", { name: "Add a swim" });
    await form.getByRole("combobox", { name: "Meet", exact: true }).selectOption("new");
    await form.getByLabel("Meet name").fill("E2E time trial");
    await form.getByLabel("Date").fill("2024-09-01");
    await form.getByLabel("Distance").selectOption("50");
    await form.getByLabel("Stroke").selectOption("fly");
    await form.getByLabel("Time").fill("1:05.99");
    await form.getByRole("button", { name: "Add swim" }).click();
    await expect(page.getByRole("status")).toHaveText("Swim added.");
    const pb = page.getByTestId("pb-row").filter({ has: page.getByRole("link", { name: "50 Fly" }) });
    await expect(pb).toContainText("1:05.99");
    await pb.getByRole("link", { name: "E2E time trial" }).click();
    await expect(row(page, "50 Fly SCM")).toContainText("Added by you");
    await expect(row(page, "50 Fly SCM")).toContainText("★ PB");
  });
});

test("the swimming page fits a phone (NFR-5)", async ({ page, context }) => {
  await signInAs(context, OWNER);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/swimming");
  await expect(page.getByRole("heading", { name: /Swimming/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
