import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { RUN, addEvent, calEvent, isolatedWeek, toronto } from "./support/calendar";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Plan M1.10 (CON-3, CON-4, NFR-9) and M1.11 (CAL-8).

test.beforeEach(async ({ context }) => {
  await signInAs(context, OWNER);
});

// Drag by `dy` pixels: mouse on desktop; on the phone profile a real touch
// long-press and drag, sent through the Chrome DevTools Protocol.
async function drag(page: Page, x: number, y: number, dy: number, touch: boolean) {
  const steps = 12;
  if (!touch) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(x, y + (dy * i) / steps);
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const point = (py: number) => [{ x, y: py, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(y) });
  await page.waitForTimeout(700); // long-press to pick it up
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(y + (dy * i) / steps),
    });
    await page.waitForTimeout(30);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("dragging one event of a clash clears the highlight, and undo brings it back (CON-3)", async ({
  page,
  context,
}, info) => {
  const monday = isolatedWeek(4, info.project.name);
  const mover = `Drag me ${RUN}`;
  const blocker = `Blocker ${RUN}`;
  await addEvent(context, {
    title: mover,
    category: "tennis",
    start: toronto(monday, "17:00"),
    end: toronto(monday, "18:00"),
  });
  await addEvent(context, {
    title: blocker,
    category: "soccer",
    start: toronto(monday, "17:00"),
    end: toronto(monday, "18:00"),
  });
  // Tall enough that the event and where it's dropped are both on screen.
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 1600 });
  await page.goto(`/?view=timeGridDay&date=${monday}`);
  await expect(calEvent(page, mover)).toHaveAttribute("data-clash", "visible");

  const box = (await calEvent(page, mover).boundingBox())!;
  const five = (await page.getByText("5pm", { exact: true }).boundingBox())!;
  const eight = (await page.getByText("8pm", { exact: true }).boundingBox())!;
  await drag(page, box.x + box.width / 2, box.y + 8, eight.y - five.y, info.project.name === "phone");

  await expect(page.getByText(`Moved ${mover}.`)).toBeVisible();
  await expect(calEvent(page, mover)).toHaveAttribute("data-clash", "none");
  await expect(calEvent(page, blocker)).toHaveAttribute("data-clash", "none");
  await expect(calEvent(page, mover)).toContainText(/8:00|8pm/i);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(calEvent(page, mover)).toHaveAttribute("data-clash", "visible");
  await expect(calEvent(page, mover)).toContainText(/5:00|5pm/i);
});

test("Move to… is a non-drag way to resolve a clash (NFR-9)", async ({ page, context }, info) => {
  const monday = isolatedWeek(4, info.project.name);
  const tue = new Date(Date.parse(`${monday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const a = `Keyboard move ${RUN}`;
  const b = `Keyboard blocker ${RUN}`;
  await addEvent(context, {
    title: a,
    category: "math",
    start: toronto(tue, "17:00"),
    end: toronto(tue, "18:00"),
  });
  await addEvent(context, {
    title: b,
    category: "chinese",
    start: toronto(tue, "17:30"),
    end: toronto(tue, "18:30"),
  });
  await page.goto(`/?view=timeGridDay&date=${tue}`);
  await expect(calEvent(page, a)).toHaveAttribute("data-clash", "visible");

  await calEvent(page, a).click();
  const dialog = page.getByRole("dialog", { name: a });
  await dialog.getByRole("button", { name: "Move to…" }).click();
  await dialog.getByLabel("New start time").fill("19:30");
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(calEvent(page, a)).toHaveAttribute("data-clash", "none");
});

test("a change on one device shows on another within 10 seconds (CAL-8)", async ({ page, browser }, info) => {
  const monday = isolatedWeek(4, info.project.name);
  const wed = new Date(Date.parse(`${monday}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  const loaded = page.waitForResponse((r) => r.url().includes("/api/v1/events?"));
  await page.goto(`/?view=timeGridDay&date=${wed}`);
  await loaded;

  const phoneB = await browser.newContext();
  await signInAs(phoneB, OWNER);
  const title = `From the other phone ${RUN} ${info.project.name}`;
  const started = Date.now();
  await addEvent(phoneB, {
    title,
    category: "fitness",
    start: toronto(wed, "12:00"),
    end: toronto(wed, "13:00"),
  });
  await expect(calEvent(page, title)).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(10_000);
  await phoneB.close();
});
