import { expect, test } from "@playwright/test";

// Spec AUTH-3 and NFR-2: nothing is indexable and security headers are sent.
test("home page is marked noindex and has security headers", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["strict-transport-security"]).toBeTruthy();
  expect(headers["x-powered-by"]).toBeUndefined();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("the page title reveals nothing personal", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Family hub");
  await expect(page.locator("body")).not.toContainText(/jayden/i);
});

test("robots.txt disallows everything", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(await res.text()).toMatch(/Disallow: \/\s*$/m);
});

test("health check responds", async ({ request }) => {
  const res = await request.get("/api/healthz");
  expect(await res.json()).toEqual({ status: "ok" });
});
