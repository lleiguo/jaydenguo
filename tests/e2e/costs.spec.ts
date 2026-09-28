import { expect, test } from "@playwright/test";
import pg from "pg";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Settings → Costs (intent 0002, COST-1..5) with made-up billing rows.

test("the Costs page shows month to date, the estimate, the chart and the table", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "desktop", "shared billing rows; one project is enough");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query("delete from daily_costs");
    // Ten days ending yesterday (home time zone is Toronto by default).
    await pool.query(`insert into daily_costs (day, service, cost, currency)
      select ((now() at time zone 'America/Toronto')::date - g), s, c, 'CAD'
      from generate_series(1, 10) g,
           (values ('Cloud SQL', 1.00), ('Vertex AI', 0.50)) as x(s, c)`);
  } finally {
    await pool.end();
  }
  await signInAs(context, OWNER);
  await page.goto("/settings/costs");
  await expect(page.getByRole("link", { name: "Costs" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("This month so far")).toBeVisible();
  await expect(page.getByText("Month-end estimate", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /Daily cost for the last 90 days/ })).toBeVisible();
  const services = page.getByRole("region", { name: "By service this month" });
  await expect(services.getByText("Cloud SQL")).toBeVisible();
  await expect(services.getByText("Vertex AI")).toBeVisible();
  await page.getByText("Every day as a table").click();
  const table = page.getByRole("table", { name: "Daily cost" });
  await expect(table.getByRole("row")).toHaveCount(91);
  await expect(page.getByRole("region", { name: "AI by feature this month" })).toContainText("Video reviews");
});
