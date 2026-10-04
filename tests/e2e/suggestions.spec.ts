import { expect, test } from "./support/test";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Suggestions from coach and club emails (plan M5.8, EML-1..3) against a
// fake Gmail, with the stand-in extractor (EMAIL_LLM=fake).

test("allowed emails become suggestions, and an approved one lands on the calendar", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  const account = `gmail-${testInfo.project.name}@example.test`;
  const name = `Coach emails ${testInfo.project.name} ${Date.now()}`;
  await signInAs(context, OWNER);
  await page.goto("/settings/accounts");
  await page.getByRole("link", { name: "Connect Gmail (coach emails)" }).click();
  await page.getByRole("link", { name: account }).click();
  await expect(page).toHaveURL(/\/settings\/accounts$/);

  await page.goto("/settings/sources");
  const form = page.getByRole("form", { name: "Add a source" });
  await form.getByLabel("Type").selectOption("gmail");
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Google account").selectOption({ label: `Google (${account})` });
  // The domain and its subdomains; the fake coach writes from club.example itself.
  await form.getByLabel(/Senders to read/).fill("*@*.club.example");
  await form.getByLabel(/Gmail labels to read/).fill("Jayden");
  await form.getByRole("button", { name: "Add source" }).click();

  const card = page.getByTestId("source").filter({ has: page.getByRole("heading", { name }) });
  await expect(card).toContainText("Reads only: *@*.club.example, label Jayden");
  // Saving checks the senders: these have email, so no warning.
  await expect(card).not.toContainText("Checking the senders", { timeout: 30_000 });
  await expect(card.getByTestId("sender-check")).toHaveCount(0);
  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(card).toContainText("2 added", { timeout: 30_000 });

  await page.goto("/settings/suggestions");
  const mine = page.getByTestId("suggestion").filter({ hasText: name });
  await expect(mine).toHaveCount(2);
  // The newsletter from a sender that isn't allowed never shows (EML-1).
  await expect(mine.filter({ hasText: "Sale" })).toHaveCount(0);

  const practice = mine.filter({ hasText: "Extra practice" });
  await expect(practice.getByRole("blockquote")).toContainText("Extra practice on 2028-06-14");
  await expect(practice.getByRole("link", { name: "open in Gmail" })).toHaveAttribute(
    "href",
    /mail\.google\.com.*msg-practice/,
  );
  await practice.getByLabel("Place").fill("East field");
  await practice.getByRole("button", { name: "Approve: add it" }).click();
  await expect(page.getByText("Added “Extra practice” to the calendar.")).toBeVisible();
  await expect(mine).toHaveCount(1);

  await mine.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Rejected.")).toBeVisible();
  await expect(mine).toHaveCount(0);

  // A misspelt sender added later is pointed out.
  await page.goto("/settings/sources");
  await card.getByRole("button", { name: "Senders" }).click();
  const senders = card.getByRole("form", { name: "Senders" });
  await expect(senders.getByLabel(/Senders to read/)).toHaveValue("*@*.club.example");
  await senders.getByLabel(/Senders to read/).fill("*@*.club.example\n*@*.clubb.example");
  await senders.getByRole("button", { name: "Save" }).click();
  await expect(card).toContainText("Reads only: *@*.club.example, *@*.clubb.example, label Jayden");
  await expect(card.getByTestId("sender-check")).toContainText(
    "No email in the last 30 days from *@*.clubb.example. Check the spelling.",
    { timeout: 30_000 },
  );

  // It's on the calendar (June 2028, away from the calendar tests' weeks).
  const res = await page.request.get("/api/v1/events?from=2028-06-12T00:00:00Z&to=2028-06-19T00:00:00Z");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { events: { title: string; sourceName?: string | null }[] };
  expect(body.events.some((e) => e.title === "Extra practice")).toBe(true);
});
