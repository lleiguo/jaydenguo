import { randomUUID } from "node:crypto";
import { expect, test } from "./support/test";
import { APP_URL, OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Settings → "Household calendar, both ways" (intent 0020, TWO-9): off until
// switched on, and never on for a calendar that isn't there.

test("two-way sync starts off and refuses a calendar that isn't set up", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "one shared setting; one project is enough");
  await signInAs(context, OWNER);
  const got = await context.request.get("/api/v1/household-sync");
  expect(got.status()).toBe(200);
  expect(await got.json()).toMatchObject({ mode: "off", held: null });

  const refused = await context.request.patch("/api/v1/household-sync", {
    data: { mode: "on", sourceId: randomUUID() },
    headers: { origin: APP_URL },
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toMatch(/household Google calendar/);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Household calendar, both ways" })).toBeVisible();
});
