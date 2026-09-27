import { expect, test, type BrowserContext } from "@playwright/test";
import pg from "pg";
import { apiSend } from "./support/api";
import { OWNER } from "./support/env";
import { TC_FIXTURE } from "./support/fake-tc";
import { FAKE_TC_PORT } from "./support/fake-tc-port";
import { signInAs } from "./support/session";

// Plan M3.3-M3.7: a Tennis Canada source syncs from a local fake of the site
// (the scrubbed fixture, "today" pinned to 2024-09-28), and the tennis
// pages show tournaments, his draw and next match with a prediction,
// head-to-head, opponent form, results with a running W–L, and a
// correction that survives the next sync. The tests share one source, so
// they run in order, on the desktop project only.

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

// SYNC-5 allows one run an hour; move the last one back to sync again now.
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

test.describe("tennis", () => {
  test.describe.configure({ mode: "serial" });
  let sourceId: string;

  test.beforeEach(async ({ context }, info) => {
    test.skip(info.project.name !== "desktop", "sync tests run once, on desktop");
    await signInAs(context, OWNER);
  });

  test("a tennis source is added with his profile link and syncs (M3.3)", async ({ page, context }) => {
    const name = `Tennis ${Date.now()}`;
    await page.goto("/settings/sources");
    const form = page.getByRole("form", { name: "Add a source" });
    await form.getByLabel("Type").selectOption("tennis_tc");
    await form.getByLabel("Name", { exact: true }).fill(name);
    await form
      .getByLabel("His profile link on tc.tournamentsoftware.com")
      .fill(`http://127.0.0.1:${FAKE_TC_PORT}/player-profile/${TC_FIXTURE.self.profileId}`);
    await expect(form.getByLabel("Default category")).toHaveValue("tennis");
    await form.getByRole("button", { name: "Add source" }).click();
    const card = page.getByTestId("source").filter({ hasText: name });
    await expect(card).toContainText("Tennis Canada tournaments · public pages · default category tennis");

    const { sources } = await apiSend(context, "GET", "/api/v1/sources");
    sourceId = sources.find((s: { name: string }) => s.name === name).id;
    await syncNow(context, sourceId);

    // His tournaments are on the calendar as all-day tennis events (TEN-2).
    const calendar = await apiSend(
      context,
      "GET",
      "/api/v1/events?from=2024-09-25T00:00:00Z&to=2024-10-02T00:00:00Z",
    );
    expect(calendar.events).toContainEqual(
      expect.objectContaining({ title: "Fixture Open 11", category: "tennis", allDay: true }),
    );
    expect(calendar.events).toContainEqual(
      expect.objectContaining({ title: "Tennis Semi final vs Casey Brackenridge", allDay: false }),
    );
  });

  test("the tennis page shows his next match with a prediction, and his tournaments (TEN-2, TEN-3, TEN-6)", async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    await page.goto("/tennis");
    const next = page.getByTestId("next-match");
    await expect(next).toHaveCount(1);
    await expect(next).toContainText("Fixture Open 11");
    await expect(next).toContainText("line 1 of 16 · seed 1");
    await expect(next).toContainText("Next: Semi final vs Casey Brackenridge · 2024-09-29 09:00");
    const prediction = next.getByTestId("prediction");
    await expect(prediction).toContainText(/Sam wins: \d+%/);
    await expect(prediction).toContainText("Estimate, not a certainty · confidence low");
    await expect(prediction).toContainText(/Why: Ratings \d+ ± \d+ vs \d+ ± \d+/);

    const inProgress = page.getByRole("region", { name: "In progress" });
    await expect(inProgress.getByTestId("tournament")).toContainText("In the draw · 1–0");
    await expect(
      page.getByRole("region", { name: "Past tournaments" }).getByTestId("tournament").first(),
    ).toBeVisible();
    expect(violations).toEqual([]);
  });

  test("a tournament shows his draws and matches (TEN-2, TEN-3)", async ({ page }) => {
    await page.goto("/tennis");
    await page.getByRole("link", { name: "Fixture Open 11" }).first().click();
    await expect(page.getByRole("heading", { name: "Fixture Open 11" })).toBeVisible();
    await expect(page.getByText("2024-09-26 – 2024-09-30 · Fixture Courts 27")).toBeVisible();
    await expect(page.getByTestId("draw")).toContainText("Next: Semi final vs Casey Brackenridge");
    const qf = page.getByTestId("tennis-match").filter({ hasText: "Quarter final" });
    await expect(qf).toContainText("W 6–1 6–1");
    await expect(qf).toContainText("Sage Alderley");
    await expect(page.getByTestId("tennis-match").filter({ hasText: "Semi final" })).toContainText(
      "not played yet",
    );
  });

  test("an opponent's page shows head-to-head and form (TEN-4, TEN-5)", async ({ page }) => {
    await page.goto("/tennis");
    await page.getByTestId("next-match").getByRole("link", { name: "Casey Brackenridge" }).click();
    await expect(page.getByRole("heading", { name: "Casey Brackenridge" })).toBeVisible();
    await expect(page.getByTestId("h2h-record")).toHaveText("0–0");
    await expect(page.getByText("They haven't played each other in singles yet.")).toBeVisible();
    await expect(page.getByTestId("win-rate")).toContainText("Last 12 months: 2–0 (100% won)");
    await expect(page.getByTestId("form-row")).toHaveCount(2);
    await expect(page.getByTestId("prediction")).toBeVisible();

    await page.goto("/tennis/tournaments/" + (await tournamentId(page, "Fixture Open 11")));
    await page
      .getByTestId("tennis-match")
      .filter({ hasText: "Quarter final" })
      .getByRole("link", { name: "Sage Alderley" })
      .click();
    await expect(page.getByTestId("h2h-record")).toHaveText("1–0");
  });

  test("results filter by season with a running W–L (TEN-7)", async ({ page }) => {
    await page.goto("/tennis/results?season=2023");
    await expect(page.getByTestId("record")).toHaveText("W–L 10–11");
    const rows = page.getByTestId("tennis-match");
    // 21 decided, plus one the site lists at 2–2 with no winner.
    await expect(rows).toHaveCount(22);
    // Newest first; the last row is the season's first match.
    await expect(rows.last()).toContainText(/1–0|0–1/);
    await expect(rows.first()).toContainText("10–11");
    await page.getByRole("link", { name: "All" }).click();
    await expect(page.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  });

  test("a correction survives the next sync and is flagged when the site disagrees (TEN-8, M3.7)", async ({
    page,
    context,
  }) => {
    await page.goto("/tennis/results?season=2024");
    const qf = page
      .getByTestId("tennis-match")
      .filter({ hasText: "Fixture Open 11" })
      .filter({ hasText: "Quarter final" });
    await qf.getByRole("button", { name: "Edit" }).click();
    const form = page.getByRole("form", { name: "Correct the match on 2024-09-28" });
    await form.getByLabel("Score (his games first)").fill("6-1 7-5");
    await form.getByRole("button", { name: "Save correction" }).click();
    await expect(qf).toContainText("W 6–1 7–5");
    await expect(qf).toContainText("Corrected by you");
    await expect(qf.getByTestId("source-disagrees")).toContainText("The site says W 6–1 6–1");

    await backdateRuns(sourceId);
    await syncNow(context, sourceId);
    await page.reload();
    await expect(qf).toContainText("W 6–1 7–5");
    await expect(qf.getByTestId("source-disagrees")).toContainText("The site says W 6–1 6–1");

    // Going back to the site's result clears the flag.
    await qf.getByRole("button", { name: "Edit" }).click();
    await form.getByRole("button", { name: "Use the site's result (W 6–1 6–1)" }).click();
    await expect(qf).toContainText("W 6–1 6–1");
    await expect(qf.getByTestId("source-disagrees")).toHaveCount(0);
  });

  test("a match added by hand shows in the results (TEN-8, SYNC-6)", async ({ page }) => {
    await page.goto("/tennis/results");
    await page.getByRole("button", { name: "+ Add a match" }).click();
    const form = page.getByRole("form", { name: "Add a match" });
    await form.getByLabel("Date", { exact: true }).fill("2024-09-27");
    await form.getByLabel("Opponent").fill("Practice Partner");
    await form.getByLabel("Score (his games first)").fill("6-4 6-4");
    await form.getByRole("button", { name: "Add match" }).click();
    await expect(page.getByRole("status")).toHaveText("Match added.");
    const row = page.getByTestId("tennis-match").filter({ hasText: "Practice Partner" });
    await expect(row).toContainText("W 6–4 6–4");
    await expect(row).toContainText("Added by you");
    await row.getByRole("button", { name: "Edit" }).click();
    await page
      .getByRole("form", { name: "Correct the match on 2024-09-27" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByRole("status").filter({ hasText: "Match deleted." })).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  test("the accuracy page shows the calibration table (TEN-6)", async ({ page }) => {
    await page.goto("/tennis/accuracy");
    await expect(page.getByRole("heading", { name: "How accurate are the predictions?" })).toBeVisible();
    await expect(page.getByTestId("accuracy-summary")).toContainText(/\d+ matches · the favourite won \d+%/);
    await expect(page.getByTestId("calibration-row")).toHaveCount(5);
  });
});

async function tournamentId(page: import("@playwright/test").Page, name: string) {
  const res = await page.request.get("/api/v1/tennis/tournaments");
  const body = await res.json();
  const all = [...body.inProgress, ...body.upcoming, ...body.past] as { id: string; name: string }[];
  return all.find((t) => t.name === name)!.id;
}

test("the tennis page fits a phone (NFR-5)", async ({ page, context }) => {
  await signInAs(context, OWNER);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/tennis");
  await expect(page.getByRole("heading", { name: /Tennis/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
