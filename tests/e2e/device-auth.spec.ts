import type { APIRequestContext } from "@playwright/test";
import { pkceChallenge } from "../../src/server/auth/tokens";
import { expect, test } from "./support/test";
import { APP_URL, INTRUDER, OWNER } from "./support/env";
import { checkResponse } from "./support/contract";

// intent 0004, API-1, API-2, API-5, API-6: the iPhone app's sign-in, walked
// through the fake Google provider the way ASWebAuthenticationSession would,
// then the API with the device token.

const verifier = "e2e-verifier-".padEnd(64, "x");
const challenge = pkceChallenge(verifier);
const location = async (res: Awaited<ReturnType<APIRequestContext["get"]>>) => {
  expect(res.status(), await res.text().catch(() => "")).toBe(303);
  return res.headers()["location"]!;
};

// Start → Google (choose an account) → callback, as a browser sheet would.
// Returns where the callback sent the sheet.
async function appSignIn(browser: APIRequestContext, email: string): Promise<URL> {
  const toGoogle = await location(
    await browser.get(`/auth/google/start?client=ios&challenge=${challenge}&device=E2E%20iPhone`, {
      maxRedirects: 0,
    }),
  );
  const chosen = new URL(toGoogle);
  chosen.searchParams.set("choose", email);
  const toCallback = await location(await browser.get(chosen.href, { maxRedirects: 0 }));
  return new URL(await location(await browser.get(toCallback, { maxRedirects: 0 })));
}

async function deviceToken(playwright: {
  request: { newContext: (o: object) => Promise<APIRequestContext> };
}) {
  const sheet = await playwright.request.newContext({ baseURL: APP_URL });
  const back = await appSignIn(sheet, OWNER);
  await sheet.dispose();
  expect(back.protocol).toBe("jaydenguohub:");
  expect(back.host).toBe("auth");
  const code = back.searchParams.get("code");
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // The app: no cookies, no Origin.
  const app = await playwright.request.newContext({ baseURL: APP_URL });
  const res = await app.post("/api/v1/auth/device", { data: { code, verifier } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(checkResponse("POST", "/api/v1/auth/device", 201, body)).toBeNull();
  return { app, token: body.token as string };
}

test.describe("iPhone app sign-in", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "no browser page involved");
  });

  test("the owner gets a device token that works on the API without cookies or Origin", async ({
    playwright,
  }) => {
    const { app, token } = await deviceToken(playwright);
    const auth = { authorization: `Bearer ${token}` };
    const me = await app.get("/api/v1/me", { headers: auth });
    expect(me.status()).toBe(200);
    expect(await me.json()).toEqual({ email: OWNER });

    // A mutation with the token and no Origin passes the CSRF check.
    const added = await app.post("/api/v1/people", { headers: auth, data: { name: `Device ${Date.now()}` } });
    expect(added.status()).toBe(201);
    const { id } = await added.json();
    expect((await app.delete(`/api/v1/people/${id}`, { headers: auth })).status()).toBe(200);

    // It's listed as a device.
    const sessions = await (await app.get("/api/v1/sessions", { headers: auth })).json();
    expect(sessions.sessions).toContainEqual(
      expect.objectContaining({ kind: "device", deviceName: "E2E iPhone", current: true }),
    );

    // Pages never take bearer tokens.
    const page = await app.get("/settings", { headers: auth, maxRedirects: 0 });
    expect(page.status()).toBe(303);
    expect(new URL(page.headers()["location"]!, APP_URL).pathname).toBe("/login");

    // Signing out ends the token.
    expect((await app.post("/api/v1/auth/signout", { headers: auth })).status()).toBe(204);
    expect((await app.get("/api/v1/me", { headers: auth })).status()).toBe(401);
    await app.dispose();
  });

  test("the code works once, and only with the right verifier", async ({ playwright }) => {
    const sheet = await playwright.request.newContext({ baseURL: APP_URL });
    const code = (await appSignIn(sheet, OWNER)).searchParams.get("code");
    await sheet.dispose();
    const app = await playwright.request.newContext({ baseURL: APP_URL });
    const wrong = await app.post("/api/v1/auth/device", { data: { code, verifier: "w".repeat(64) } });
    expect(wrong.status()).toBe(401);
    expect(checkResponse("POST", "/api/v1/auth/device", 401, await wrong.json())).toBeNull();
    // The failed try used the code up.
    expect((await app.post("/api/v1/auth/device", { data: { code, verifier } })).status()).toBe(401);
    await app.dispose();
  });

  test("an account not on the allow-list goes back to the app with an error and no code", async ({
    playwright,
  }) => {
    const sheet = await playwright.request.newContext({ baseURL: APP_URL });
    const back = await appSignIn(sheet, INTRUDER);
    await sheet.dispose();
    expect(back.href).toBe("jaydenguohub://auth?error=not_authorised");
  });

  test("a malformed or unknown token is refused, even alongside a good cookie", async ({ playwright }) => {
    const { app, token } = await deviceToken(playwright);
    await app.post("/api/v1/auth/signout", { headers: { authorization: `Bearer ${token}` } });
    for (const authorization of [`Bearer ${token}`, "Bearer nope", "Basic dXNlcjpwYXNz"]) {
      expect((await app.get("/api/v1/me", { headers: { authorization } })).status(), authorization).toBe(401);
    }
    await app.dispose();
  });

  test("an app build older than the minimum is asked to update", async ({ playwright }) => {
    const { app, token } = await deviceToken(playwright);
    const auth = { authorization: `Bearer ${token}` };
    const old = await app.get("/api/v1/me", { headers: { ...auth, "x-app-version": "0.9.0" } });
    expect(old.status()).toBe(426);
    expect((await old.json()).error).toMatch(/too old/);
    expect((await app.get("/api/v1/me", { headers: { ...auth, "x-app-version": "1.0.0" } })).status()).toBe(
      200,
    );
    await app.post("/api/v1/auth/signout", { headers: auth });
    await app.dispose();
  });

  test("a handoff link opens Google connect signed in, once", async ({ playwright }) => {
    const { app, token } = await deviceToken(playwright);
    const auth = { authorization: `Bearer ${token}` };
    const next = "/accounts/google/connect?feature=drive&next=/auth/app-done";
    const res = await app.post("/api/v1/auth/handoff", { headers: auth, data: { next } });
    expect(res.status()).toBe(201);
    const { url } = await res.json();

    const sheet = await playwright.request.newContext({ baseURL: APP_URL });
    const opened = await sheet.get(url, { maxRedirects: 0 });
    expect(await location(opened)).toBe(`${APP_URL}${next}`);
    // Signed in: the connect flow sends the sheet on to Google.
    const connect = await sheet.get(next, { maxRedirects: 0 });
    expect(new URL(await location(connect)).pathname).toBe("/authorize");
    // The end of the flow ends the web session and returns to the app.
    const done = await sheet.get("/auth/app-done", { maxRedirects: 0 });
    expect(await location(done)).toBe("jaydenguohub://done");
    expect((await sheet.get("/api/v1/me", { headers: { origin: APP_URL } })).status()).toBe(401);
    // The link was single use.
    expect(await location(await sheet.get(url, { maxRedirects: 0 }))).toBe(
      "jaydenguohub://done?error=expired",
    );
    // Handoff can't open other pages.
    expect(
      (await app.post("/api/v1/auth/handoff", { headers: auth, data: { next: "/settings" } })).status(),
    ).toBe(400);

    await sheet.dispose();
    await app.post("/api/v1/auth/signout", { headers: auth });
    await app.dispose();
  });
});
