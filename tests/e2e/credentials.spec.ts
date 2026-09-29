import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import pg from "pg";
import { FAKE_OIDC_PORT } from "./support/fake-oidc-port";
import { OWNER } from "./support/env";
import { builtRoutes } from "./support/routes";
import { signInAs } from "./support/session";

// Plan M1.3: add, test, update and remove a credential; secrets are
// write-only (CRED-1, CRED-4, CRED-6, CRED-7).

const feed = (name: string) => `http://127.0.0.1:${FAKE_OIDC_PORT}/ical/${name}`;

async function credentialRows(label: string) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query("select * from credentials where label = $1", [label]);
    return rows;
  } finally {
    await pool.end();
  }
}

function card(page: Page, label: string) {
  return page.getByTestId("credential").filter({ hasText: label });
}

test("a private calendar link can be added, tested, updated and removed without ever being shown", async ({
  page,
  context,
}, testInfo) => {
  const label = `Soccer team ${testInfo.project.name} ${Date.now()}`;
  const secretLink = feed("team.ics") + `?token=secret-${Date.now()}`;
  await signInAs(context, OWNER);
  await page.goto("/settings/accounts");

  const teamsnap = page.getByRole("region", { name: "TeamSnap" });
  await teamsnap.getByRole("button", { name: "Add private calendar link" }).click();
  await teamsnap.getByLabel("Name").fill(label);
  await teamsnap.getByLabel("Calendar link").fill(secretLink);
  await teamsnap.getByRole("button", { name: "Save" }).click();

  await expect(card(page, label)).toContainText("••••");

  // Stored sealed: no plaintext in the row.
  const [row] = await credentialRows(label);
  expect(row.ciphertext.toString("utf8")).not.toContain("secret-");
  expect(JSON.stringify(row)).not.toContain(secretLink);

  // No page or API response contains it (CRED-4).
  expect(await page.content()).not.toContain(secretLink);
  // (Sign-in and connect flows are skipped: they start new sessions.)
  for (const route of builtRoutes().filter((r) => !/^\/(auth|accounts\/google)\//.test(r))) {
    const res = await context.request.get(route.replace("00000000-0000-4000-8000-000000000000", row.id));
    expect(await res.text(), route).not.toContain("secret-");
  }

  // Test connection runs as a worker job and reports back.
  await card(page, label).getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(`${label}: connection works.`)).toBeVisible({ timeout: 30_000 });

  // Update to a link that no longer works; the test says so.
  await card(page, label).getByRole("button", { name: "Update" }).click();
  await card(page, label).getByLabel("Calendar link").fill(feed("missing.ics"));
  await card(page, label).getByRole("button", { name: "Save changes" }).click();
  await card(page, label).getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(`${label}: The calendar link no longer works`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(card(page, label)).toContainText("last test");
  await expect(card(page, label)).toContainText("The calendar link no longer works");

  // Remove deletes the ciphertext.
  page.once("dialog", (d) => d.accept());
  await card(page, label).getByRole("button", { name: "Remove" }).click();
  await expect(card(page, label)).toHaveCount(0);
  expect(await credentialRows(label)).toHaveLength(0);

  // Every step is audited, without values (CRED-7).
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const { rows } = await pool.query("select action, details from audit_log where target = $1 order by at", [
    row.id,
  ]);
  await pool.end();
  expect(rows.map((r) => r.action)).toEqual(
    expect.arrayContaining([
      "credential.create",
      "credential.test_requested",
      "credential.use",
      "credential.update",
      "credential.delete",
    ]),
  );
  expect(JSON.stringify(rows)).not.toContain("secret-");
});

test("a Google account can be connected, tested and removed (revoked)", async ({
  page,
  context,
}, testInfo) => {
  const account = `calendar-${testInfo.project.name}@example.test`;
  await signInAs(context, OWNER);
  await page.goto("/settings/accounts");
  const google = page.getByRole("region", { name: "Google" });
  await google.getByRole("link", { name: /Connect Google account|Reconnect Google/ }).click();
  await page.getByRole("link", { name: account }).click();
  await expect(page).toHaveURL(/\/settings\/accounts$/);

  const label = `Google (${account})`;
  await expect(card(page, label)).toContainText("Google access");
  const [row] = await credentialRows(label);
  expect(row.scopes).toContain("https://www.googleapis.com/auth/calendar.readonly");

  await card(page, label).getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(`${label}: connection works.`)).toBeVisible({ timeout: 30_000 });

  page.once("dialog", (d) => d.accept());
  await card(page, label).getByRole("button", { name: "Remove" }).click();
  await expect.poll(async () => (await credentialRows(label)).length, { timeout: 30_000 }).toBe(0);
});

test("a school account can be connected for Classroom and its classes are counted (SP-5)", async ({
  page,
  context,
}, testInfo) => {
  const account = `school-${testInfo.project.name}@example.test`;
  await signInAs(context, OWNER);
  await page.goto("/settings/accounts");
  await page
    .getByRole("region", { name: "Google" })
    .getByRole("link", { name: "Connect school account (Classroom)" })
    .click();
  await page.getByRole("link", { name: account }).click();
  await expect(page).toHaveURL(/\/settings\/accounts$/);

  const label = `Google (${account})`;
  await expect(card(page, label)).toContainText("Classroom: 3 active classes readable");
  const [row] = await credentialRows(label);
  expect(row.scopes).toEqual(
    expect.arrayContaining([
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    ]),
  );
  expect(row.scopes).not.toContain("https://www.googleapis.com/auth/calendar.readonly");
  // Only a count is kept: no class names.
  expect(JSON.stringify(row.meta)).not.toContain("Science");

  await card(page, label).getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(`${label}: connection works.`)).toBeVisible({ timeout: 30_000 });

  page.once("dialog", (d) => d.accept());
  await card(page, label).getByRole("button", { name: "Remove" }).click();
  await expect.poll(async () => (await credentialRows(label)).length, { timeout: 30_000 }).toBe(0);
});

test("a school admin's refusal is shown with Google's error code (F-5)", async ({ page, context }) => {
  await signInAs(context, OWNER);
  await page.goto("/settings/accounts");
  await page.getByRole("link", { name: "Connect school account (Classroom)" }).click();
  await page.getByRole("link", { name: "blocked-school@example.test" }).click();
  await expect(page).toHaveURL(/error=google&reason=admin_policy_enforced/);
  await expect(page.getByRole("status")).toHaveText("Google refused the connection (admin_policy_enforced).");
  expect(await credentialRows("Google (blocked-school@example.test)")).toHaveLength(0);
});

test("the credentials API refuses bad input and has no secret field", async ({ context }) => {
  await signInAs(context, OWNER);
  const bad = await context.request.post("/api/v1/credentials", {
    headers: { origin: context.pages()[0]?.url() ?? "http://127.0.0.1:3100" },
    data: { kind: "secret_url", provider: "teamsnap", label: "x", secret: "javascript:alert(1)" },
  });
  expect(bad.status()).toBe(400);
  const list = await context.request.get("/api/v1/credentials");
  for (const c of (await list.json()).credentials) {
    expect(Object.keys(c)).not.toEqual(expect.arrayContaining(["secret"]));
    expect(Object.keys(c)).not.toContain("ciphertext");
    expect(Object.keys(c)).not.toContain("wrappedDek");
  }
});

test("a link that isn't a calendar link is refused with a reason, and the link is visible while typing", async ({
  page,
  context,
}) => {
  await signInAs(context, OWNER);
  await page.goto("/settings/accounts");
  const spordle = page.getByRole("region", { name: "Spordle" });
  await spordle.getByRole("button", { name: "Add private calendar link" }).click();
  const field = spordle.getByLabel("Calendar link");
  await expect(field).toHaveAttribute("type", "text");
  await spordle.getByLabel("Name").fill("Hockey");
  await field.fill("page.example.test/team/42");
  await spordle.getByRole("button", { name: "Save" }).click();
  await expect(
    spordle.getByText("That isn't a calendar link. It should start with webcal:// or https://."),
  ).toBeVisible();
});
