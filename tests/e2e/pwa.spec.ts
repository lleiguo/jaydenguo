import { expect, test } from "@playwright/test";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Plan M1.12 (NFR-5): installable on iOS and Android. Lighthouse no longer
// has a PWA category, so the install criteria are checked directly.

test("the manifest has what browsers need to install the app", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ name: "Family hub", start_url: "/", display: "standalone" });
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  for (const icon of m.icons) {
    const img = await request.get(icon.src);
    expect(img.headers()["content-type"]).toBe("image/png");
  }
  expect((await request.get("/icons/apple-touch-icon.png")).ok()).toBe(true);
});

test("the login page links the manifest and an Apple touch icon", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon\.png/);
});

test("a service worker takes control, caches no API data, and serves an offline page", async ({
  page,
  context,
}) => {
  await signInAs(context, OWNER);
  await page.goto("/settings");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await page.evaluate(() => fetch("/api/v1/me"));
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) {
      for (const req of await (await caches.open(key)).keys()) urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
  expect(cached).toContain("/offline.html");
  expect(cached.filter((u) => u.startsWith("/api/") || u === "/settings")).toEqual([]);

  await context.setOffline(true);
  await page.reload().catch(() => {});
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await context.setOffline(false);
});
