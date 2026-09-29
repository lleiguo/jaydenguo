import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./support/test";
import { APP_URL, INTRUDER, OWNER, soleOwner } from "./support/env";
import { protectedRoutes } from "./support/routes";
import { signInAs } from "./support/session";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// Same-origin header so the CSRF check passes and the auth check is what's tested.
async function expectRefused(request: APIRequestContext, route: string) {
  for (const method of METHODS) {
    const res = await request.fetch(route, { method, headers: { origin: APP_URL }, maxRedirects: 0 });
    const label = `${method} ${route}`;
    if (route.startsWith("/api/")) {
      expect(res.status(), label).toBe(401);
    } else {
      expect(res.status(), label).toBe(303);
      expect(
        new URL(res.headers()["location"] ?? "", APP_URL).pathname,
        `${label} -> ${res.headers()["location"]}`,
      ).toBe("/login");
    }
    expect(res.headers()["cache-control"], label).toBe("private, no-store");
  }
}

test.describe("sign-in gate (AUTH-1, AUTH-2)", () => {
  test("the route list is generated from the build", () => {
    const routes = protectedRoutes();
    expect(routes).toEqual(expect.arrayContaining(["/", "/settings", "/api/v1/me"]));
  });

  test("anonymous requests are refused on every route", async ({ request }) => {
    for (const route of protectedRoutes()) await expectRefused(request, route);
  });

  test("a session of an account not on the allow-list is refused on every route", async ({ context }) => {
    await signInAs(context, INTRUDER);
    for (const route of protectedRoutes()) await expectRefused(context.request, route);
  });

  test("a forged cookie is refused", async ({ context }) => {
    await context.addCookies([{ name: "__session", value: "A".repeat(43), url: APP_URL }]);
    await expectRefused(context.request, "/api/v1/me");
  });

  test("the owner's session is accepted", async ({ context }) => {
    await signInAs(context, OWNER);
    const res = await context.request.get("/api/v1/me");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ email: OWNER });
  });
});

test.describe("Google sign-in (fake provider)", () => {
  test("the owner signs in and returns to the page they asked for", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
    await page.getByRole("link", { name: "Sign in with Google" }).click();
    await page.getByRole("link", { name: OWNER }).click();
    await expect(page).toHaveURL(`${APP_URL}/settings`);
    await expect(page.getByText(`Signed in as ${OWNER}`)).toBeVisible();
  });

  test("another Google account gets 'not authorised' and no session", async ({ page, context }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Sign in with Google" }).click();
    await page.getByRole("link", { name: INTRUDER }).click();
    await expect(page).toHaveURL(/\/login\?error=not_authorised$/);
    await expect(page.getByText("not authorised to use this site")).toBeVisible();
    expect((await context.cookies()).find((c) => c.name === "__session")).toBeUndefined();
    expect((await context.request.get("/api/v1/me")).status()).toBe(401);
  });

  test("a callback without the matching pre-login session is refused", async ({ page }) => {
    await page.goto("/auth/google/callback?code=stolen&state=guess");
    await expect(page).toHaveURL(/\/login\?error=expired$/);
  });
});

test.describe("sessions (AUTH-4)", () => {
  test("sign out ends this session", async ({ page, context }) => {
    await signInAs(context, OWNER);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.request.get("/api/v1/me")).status()).toBe(401);
  });

  test("sign out everywhere ends every device's session", async ({ page, context, browser }, testInfo) => {
    const owner = soleOwner(testInfo.project.name);
    await signInAs(context, owner);
    const other = await browser.newContext();
    await signInAs(other, owner);
    expect((await other.request.get("/api/v1/me")).status()).toBe(200);

    await page.goto("/settings");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await other.request.get("/api/v1/me")).status()).toBe(401);
    await other.close();
  });
});

test.describe("request hardening (NFR-2)", () => {
  test("mutations from another origin are refused", async ({ context }) => {
    await signInAs(context, OWNER);
    const res = await context.request.post("/api/v1/sessions/revoke-all", {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status()).toBe(403);
    expect((await context.request.get("/api/v1/me")).status()).toBe(200);
  });

  test("the dev sign-in shortcut does not exist in the production build", async ({ request }) => {
    expect((await request.get("/auth/dev", { maxRedirects: 0 })).status()).toBe(404);
  });

  test("pages use a nonce CSP with no unsafe-inline and render without violations", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    await signInAs(context, OWNER);
    const res = await page.goto("/settings");
    const csp = res!.headers()["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(res!.headers()["cache-control"]).toBe("private, no-store");
    await expect(page.getByRole("button", { name: "Sign out everywhere" })).toBeEnabled();
    expect(violations).toEqual([]);
  });
});
