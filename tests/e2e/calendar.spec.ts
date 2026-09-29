import { expect, test } from "@playwright/test";
import { apiSend } from "./support/api";
import {
  RUN,
  addDays,
  addEvent,
  addSourceEvent,
  calEvent,
  isolatedWeek,
  openWeek,
  toronto,
} from "./support/calendar";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Plan M1.8 (CAL-1..5, CAL-3a, CAL-7, CAL-9) and M1.9 (CON-2) in the browser.

test.beforeEach(async ({ context }) => {
  await signInAs(context, OWNER);
});

test("views switch without a page reload, and agenda is the default on phones (CAL-2)", async ({
  page,
  context,
}, info) => {
  const monday = isolatedWeek(0, info.project.name);
  await addEvent(context, {
    title: `View check ${RUN}`,
    category: "tennis",
    start: toronto(monday, "17:00"),
    end: toronto(monday, "18:00"),
  });
  await page.goto(`/?date=${monday}`);
  const defaultView = info.project.name === "phone" ? "Agenda view" : "Week view";
  await expect(page.getByRole("tab", { name: defaultView })).toHaveAttribute("aria-selected", "true");

  let loads = 0;
  page.on("load", () => loads++);
  for (const view of ["Day view", "Month view", "Agenda view", "Week view"]) {
    await page.getByRole("tab", { name: view }).click();
    await expect(page.getByRole("tab", { name: view })).toHaveAttribute("aria-selected", "true");
  }
  await expect(calEvent(page, `View check ${RUN}`)).toBeVisible();
  expect(loads).toBe(0);
});

test("categories have their own icon, and the event shows where it came from (CAL-1, CAL-4)", async ({
  page,
  context,
}, info) => {
  const monday = isolatedWeek(1, info.project.name);
  const source = `Team feed ${info.project.name}`;
  await addSourceEvent({
    source,
    title: `League game ${RUN}`,
    category: "hockey",
    start: toronto(monday, "18:00"),
    end: toronto(monday, "19:00"),
  });
  await addEvent(context, {
    title: `Swim meet warmup ${RUN}`,
    category: "swimming",
    start: toronto(addDays(monday, 1), "07:00"),
    end: toronto(addDays(monday, 1), "08:00"),
  });
  await openWeek(page, monday);

  await expect(calEvent(page, `League game ${RUN}`).getByRole("img", { name: "Hockey" })).toBeVisible();
  await expect(
    calEvent(page, `Swim meet warmup ${RUN}`).getByRole("img", { name: "Swimming" }),
  ).toBeVisible();

  await calEvent(page, `League game ${RUN}`).click();
  const dialog = page.getByRole("dialog", { name: `League game ${RUN}` });
  await expect(dialog.getByTestId("event-source")).toContainText(`From ${source}, last synced`);
  await expect(dialog.getByRole("link", { name: "Open at the source" })).toHaveAttribute(
    "href",
    "https://example.test/team/event/1",
  );
});

test("School and Activities chips hide layers, closures stay, and hidden clashes are marked (CAL-3a, CAL-7)", async ({
  page,
  context,
}, info) => {
  const monday = isolatedWeek(2, info.project.name);
  const tue = addDays(monday, 1);
  const wed = addDays(monday, 2);
  await addEvent(context, {
    title: `Class block ${RUN}`,
    category: "school_class",
    start: toronto(tue, "08:30"),
    end: toronto(tue, "15:00"),
  });
  await addEvent(context, {
    title: `Dentist at noon ${RUN}`,
    category: "other",
    start: toronto(tue, "12:00"),
    end: toronto(tue, "13:00"),
  });
  await addEvent(context, {
    title: `PD day ${RUN}`,
    category: "school_closure",
    allDay: true,
    start: `${wed}T00:00:00.000Z`,
    end: `${addDays(wed, 1)}T00:00:00.000Z`,
  });
  await addEvent(context, {
    title: `Soccer camp ${RUN}`,
    category: "soccer",
    start: toronto(wed, "09:00"),
    end: toronto(wed, "15:00"),
  });
  await openWeek(page, monday);

  // An all-day event sits on its own date, not the day before (stored as a
  // UTC midnight; the home zone is behind UTC).
  await expect(calEvent(page, `PD day ${RUN}`).locator("xpath=ancestor::*[@data-date][1]")).toHaveAttribute(
    "data-date",
    wed,
  );

  await expect(calEvent(page, `Dentist at noon ${RUN}`)).toHaveAttribute("data-clash", "visible");
  // On the closure day the camp doesn't clash with school, and says so.
  await expect(calEvent(page, `Soccer camp ${RUN}`)).toHaveAttribute("data-clash", "none");
  await expect(calEvent(page, `Soccer camp ${RUN}`)).toContainText("🚫");

  await page.getByRole("button", { name: "🏫 School" }).click();
  await expect(calEvent(page, `Class block ${RUN}`)).toHaveCount(0);
  await expect(calEvent(page, `PD day ${RUN}`)).toBeVisible();
  await expect(calEvent(page, `Dentist at noon ${RUN}`)).toHaveAttribute("data-clash", "hidden");
  await expect(
    calEvent(page, `Dentist at noon ${RUN}`).getByRole("img", { name: "clash with a hidden event" }),
  ).toBeVisible();

  // The choice persists on this device.
  await page.reload();
  await expect(page.getByRole("button", { name: "🏫 School" })).toHaveAttribute("aria-pressed", "false");
  await expect(calEvent(page, `Class block ${RUN}`)).toHaveCount(0);

  await page.getByRole("button", { name: "⚽ Activities" }).click();
  await expect(calEvent(page, `Soccer camp ${RUN}`)).toHaveCount(0);
  await page.getByRole("button", { name: "🏫 School" }).click();
  await page.getByRole("button", { name: "⚽ Activities" }).click();
  await expect(calEvent(page, `Class block ${RUN}`)).toBeVisible();
});

test("a school day's classes fold into one School block that expands and collapses (SCH-1)", async ({
  page,
  context,
}, info) => {
  const monday = isolatedWeek(5, info.project.name);
  const tue = addDays(monday, 1);
  const periods = [
    ["08:30", "09:20"],
    ["09:30", "10:20"],
    ["13:00", "14:00"],
  ];
  for (const [i, [from, to]] of periods.entries()) {
    await addEvent(context, {
      title: `Period ${i + 1} ${RUN}`,
      category: "school_class",
      start: toronto(tue, from),
      end: toronto(tue, to),
    });
  }
  await addEvent(context, {
    title: `Orthodontist ${RUN}`,
    category: "other",
    start: toronto(tue, "13:30"),
    end: toronto(tue, "14:30"),
  });
  await openWeek(page, monday);

  // Collapsed by default: one block, carrying the clash of the class inside.
  const block = page.getByTestId("school-block").filter({ hasText: "School · 3 classes" });
  await expect(block).toHaveCount(1);
  await expect(block).toHaveAttribute("data-date", tue);
  await expect(block).toHaveAttribute("data-clash", "visible");
  await expect(calEvent(page, `Period 1 ${RUN}`)).toHaveCount(0);

  await block.click();
  await expect(page.getByTestId("school-block")).toHaveCount(0);
  for (const i of [1, 2, 3]) await expect(calEvent(page, `Period ${i} ${RUN}`)).toBeVisible();
  await expect(calEvent(page, `Period 3 ${RUN}`)).toHaveAttribute("data-clash", "visible");

  await page.getByRole("button", { name: "Collapse school" }).click();
  await expect(block).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Collapse school" })).toHaveCount(0);

  // Hiding the School layer hides the block too (CAL-3a).
  await page.getByRole("button", { name: "🏫 School" }).click();
  await expect(page.getByTestId("school-block")).toHaveCount(0);
  await expect(calEvent(page, `Orthodontist ${RUN}`)).toHaveAttribute("data-clash", "hidden");
  await page.getByRole("button", { name: "🏫 School" }).click();
});

test("a repeating event keeps its local time across the daylight-saving change (CAL-5, CAL-9)", async ({
  page,
  context,
}, info) => {
  // Clocks go forward in Toronto on Sunday 2027-03-14.
  const title = `Piano ${info.project.name} ${RUN} ${info.repeatEachIndex}`;
  await apiSend(context, "POST", "/api/v1/series", {
    title,
    category: "other",
    startDate: "2027-03-08",
    untilDate: "2027-03-19",
    startTime: "17:00",
    durationMin: 45,
    weekdays: [1],
    intervalWeeks: 1,
    timeZone: "America/Toronto",
  });
  const res = await apiSend(
    context,
    "GET",
    "/api/v1/events?from=2027-03-07T00:00:00Z&to=2027-03-20T00:00:00Z",
  );
  const starts = res.events
    .filter((e: { title: string }) => e.title === title)
    .map((e: { start: string }) => e.start);
  expect(starts).toEqual(["2027-03-08T22:00:00.000Z", "2027-03-15T21:00:00.000Z"]);
  for (const monday of ["2027-03-08", "2027-03-15"]) {
    await page.goto(`/?view=listWeek&date=${monday}`);
    await expect(calEvent(page, title)).toContainText(/5:00|5pm/i);
  }
});

test("manual events: add a repeating one in the form, delete one, restore it (CAL-5, CAL-6)", async ({
  page,
}, info) => {
  const monday = isolatedWeek(3, info.project.name);
  const title = `Art club ${info.project.name} ${RUN}`;
  await openWeek(page, monday);
  await page.getByRole("button", { name: "+ Add event" }).click();
  const dialog = page.getByRole("dialog", { name: "Add event" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Category").selectOption("other");
  await dialog.getByLabel("Repeats weekly").check();
  await dialog.getByLabel("First date").fill(monday);
  await dialog.getByLabel("Start time").fill("16:00");
  await dialog.getByLabel("End time").fill("17:00");
  await dialog.getByLabel("Tue").check();
  await dialog.getByLabel("Thu").check();
  await dialog.getByLabel("Until (optional)").fill(addDays(monday, 13));
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(calEvent(page, title)).toHaveCount(2);

  await calEvent(page, title).first().click();
  await page.getByRole("dialog", { name: title }).getByRole("button", { name: "Delete" }).click();
  await expect(calEvent(page, title)).toHaveCount(1);

  await page.goto("/settings/deleted");
  await page
    .getByRole("listitem")
    .filter({ hasText: title })
    .getByRole("button", { name: "Restore" })
    .click();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
  await openWeek(page, monday);
  await expect(calEvent(page, title)).toHaveCount(2);
});

test("clashes show a badge and a list, and can be accepted (CON-2, CON-4)", async ({
  page,
  context,
}, info) => {
  // Within the next 60 days so the badge counts it, and late at night so
  // nothing else (seed data, other tests) is involved.
  const day = new Date(Date.now() + (5 + info.repeatEachIndex) * 86_400_000).toISOString().slice(0, 10);
  const tag = `${RUN} ${info.project.name} ${info.repeatEachIndex}`;
  const a = await addEvent(context, {
    title: `Badge clash A ${tag}`,
    category: "tennis",
    start: `${day}T04:00:00.000Z`,
    end: `${day}T05:00:00.000Z`,
  });
  const b = await addEvent(context, {
    title: `Badge clash B ${tag}`,
    category: "swimming",
    start: `${day}T04:30:00.000Z`,
    end: `${day}T05:30:00.000Z`,
  });

  // The old address still works (it moved under Settings).
  await page.goto("/clashes");
  await expect(page).toHaveURL(/\/settings\/clashes$/);
  const badge = page.getByRole("navigation", { name: "Main" }).getByTestId("clash-badge");
  await expect(page.getByRole("navigation", { name: "Settings" }).getByTestId("clash-badge")).toBeVisible();
  await expect(badge).toBeVisible();
  const row = page
    .getByTestId("clash")
    .filter({ hasText: `Badge clash A ${tag}` })
    .filter({ hasText: `Badge clash B ${tag}` });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Accept clash" }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Accepted" })).toContainText(`Badge clash A ${tag}`);
  // The badge shows the number of open clashes (other tests may add some).
  await expect
    .poll(async () => {
      const api = await apiSend(context, "GET", "/api/v1/clashes?days=60");
      await page.evaluate(() => window.dispatchEvent(new Event("hub:changed")));
      const shown = Number((await badge.textContent({ timeout: 1000 }).catch(() => "0")) || 0);
      return shown === api.open;
    })
    .toBe(true);
  await apiSend(context, "DELETE", `/api/v1/events/${a}`);
  await apiSend(context, "DELETE", `/api/v1/events/${b}`);
});

test("the week view is usable at 375 px wide (CAL-2, NFR-5)", async ({ page, context }, info) => {
  const monday = isolatedWeek(0, info.project.name);
  const title = `Narrow ${RUN}`;
  await addEvent(context, {
    title,
    category: "soccer",
    start: toronto(addDays(monday, 3), "17:00"),
    end: toronto(addDays(monday, 3), "18:30"),
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await openWeek(page, monday);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await calEvent(page, title).click();
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
});

test("the calendar runs under the strict CSP with no violations (NFR-2)", async ({ page }, info) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await openWeek(page, isolatedWeek(1, info.project.name));
  await page.getByRole("tab", { name: "Month view" }).click();
  await page.getByRole("button", { name: "+ Add event" }).click();
  await expect(page.getByRole("dialog", { name: "Add event" })).toBeVisible();
  expect(violations).toEqual([]);
});
