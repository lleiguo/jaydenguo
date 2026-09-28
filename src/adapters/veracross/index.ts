import type { Browser, BrowserContext, BrowserContextOptions, Page } from "playwright-core";
import { addDays, localDate, weekday } from "../../domain/time";
import { USER_AGENT } from "../http";
import { SyncError, type Adapter, type AdapterContext, type BrowserSession } from "../types";
import { normaliseVeracross, type VeracrossRaw } from "./normalise";
import { parseDailySchedule, type VcDay } from "./parse";

// Veracross parent portal (SRC-7, SCH-1; spikes.md SP-4): signs in with the
// owner's stored parent login in headless Chromium, finds the student on
// "My Children", then reads the next two weeks of school days from the
// server-rendered Daily Schedule pages. The sign-in page wasn't mapped, so
// it's filled generically: a username field and a password field, on one
// page or two. Polite (SYNC-5): pages 2 s apart, no images or fonts, and the
// browser identifies the app.

const PORTAL_HOST = "portals.veracross.com";
const DAYS_AHEAD = 14;
const minGap = () => Number(process.env.FETCH_MIN_GAP_MS ?? 2000);

export type VeracrossConfig = { portalUrl?: string; studentFirstName?: string };

// The parent portal's address, e.g. https://portals.veracross.com/<school>/parent.
// Tests point VERACROSS_BASE_URL at a loopback fake; nothing else is
// accepted, so the login can only ever go to Veracross.
export function portalFrom(portalUrl: string | undefined): string | null {
  if (!portalUrl) return null;
  let u: URL;
  try {
    u = new URL(portalUrl.trim());
  } catch {
    return null;
  }
  const school = u.pathname.match(/^\/([a-z0-9_-]+)\/parent\b/i)?.[1];
  if (!school || u.protocol !== "https:" || u.hostname !== PORTAL_HOST) return null;
  const override = process.env.VERACROSS_BASE_URL;
  if (override) {
    const o = new URL(override);
    if (o.hostname !== "127.0.0.1" && o.hostname !== "localhost")
      throw new Error("VERACROSS_BASE_URL must be a loopback address");
    return `${o.origin}/${school}/parent`;
  }
  return `https://${PORTAL_HOST}/${school}/parent`;
}

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  try {
    return await chromium.launch({
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ["--disable-dev-shm-usage"],
    });
  } catch {
    throw new SyncError("The sync browser couldn't start. It will be tried again next time.");
  }
}

const onPortal = (url: string, portal: string) => url.startsWith(portal);

const USER_FIELD =
  'input[type="email"], input[autocomplete="username"], input[name*="user" i], input[id*="user" i], input[name*="email" i], input[name*="login" i]';
const PASSWORD_FIELD = 'input[type="password"]';
const CODE_FIELD =
  'input[autocomplete="one-time-code"], input[name*="code" i], input[id*="code" i], input[inputmode="numeric"]';
const asksForCode = (text: string) =>
  /verification|one.?time|two.?(step|factor)|authenticator|enter the code/i.test(text);
export const NEEDS_CODE =
  "Veracross needs a sign-in code. On Settings → Accounts, press Test connection on the Veracross login and enter the code it emails you.";

const bodyText = async (page: Page) =>
  (
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  ).slice(0, 5000);

// Veracross emailed a code (it doesn't know this browser yet): wait for the
// owner to type it on the Accounts page, tick "remember this device", send it.
async function enterCode(page: Page, portal: string, session: BrowserSession | undefined) {
  if (!session?.waitForCode) throw new SyncError(NEEDS_CODE);
  const field = page.locator(CODE_FIELD).filter({ visible: true }).first();
  if (!(await field.count()))
    throw new SyncError("Veracross's sign-in code page has changed, so this sync needs an update.");
  const code = await session.waitForCode();
  if (!code)
    throw new SyncError(
      "No sign-in code was entered in time. Press Test connection on the Veracross login to try again.",
    );
  await field.fill(code);
  const byName = page.getByRole("checkbox", { name: /remember|trust|don.?t ask/i });
  const boxes = page.locator('input[type="checkbox"]').filter({ visible: true });
  const remember = (await byName.count()) ? byName.first() : (await boxes.count()) === 1 ? boxes : null;
  if (remember && !(await remember.isChecked())) await remember.check();
  await field.press("Enter");
  await page.waitForURL((u) => onPortal(u.href, portal), { timeout: 30_000 }).catch(() => {});
  if (!onPortal(page.url(), portal))
    throw new SyncError(
      "Veracross didn't accept the code. Press Test connection on the Veracross login to get a new one.",
    );
}

// Opens the portal, signing in if it sends us to a sign-in page.
export async function signIn(
  browser: Browser,
  portal: string,
  username: string,
  password: string,
  session?: BrowserSession,
): Promise<Page> {
  const version = browser.version();
  // Cookies from the last run: the session, and "remember this device".
  let storageState: BrowserContextOptions["storageState"];
  try {
    const saved = await session?.load();
    storageState = saved ? JSON.parse(saved) : undefined;
  } catch {
    storageState = undefined;
  }
  const context: BrowserContext = await browser.newContext({
    storageState,
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 ${USER_AGENT}`,
  });
  await context.addInitScript("globalThis.__name ??= (f) => f;");
  await context.route(/\.(png|jpe?g|gif|webp|svg|woff2?|ttf|mp4)(\?|$)/i, (route) => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  try {
    await page.goto(portal, { waitUntil: "domcontentloaded" });
  } catch {
    throw new SyncError("Veracross didn't load. The site may be down; it will be tried again next time.");
  }

  // Up to two steps: username (and maybe password), then password.
  for (let step = 0; step < 3 && !onPortal(page.url(), portal); step++) {
    const user = page.locator(USER_FIELD).filter({ visible: true }).first();
    const pass = page.locator(PASSWORD_FIELD).filter({ visible: true }).first();
    await Promise.race([
      user.waitFor({ timeout: 15_000 }),
      pass.waitFor({ timeout: 15_000 }),
      page.waitForURL((u) => onPortal(u.href, portal), { timeout: 15_000 }),
    ]).catch(() => {});
    if (onPortal(page.url(), portal)) break;
    const hasUser = (await user.count()) > 0 && !(await user.inputValue().catch(() => ""));
    const hasPass = (await pass.count()) > 0;
    if (!hasUser && !hasPass) break;
    if (hasUser) await user.fill(username);
    if (hasPass) await pass.fill(password);
    await (hasPass ? pass : user).press("Enter");
    await Promise.race([
      page.waitForURL((u) => onPortal(u.href, portal), { timeout: 30_000 }),
      page.waitForLoadState("domcontentloaded", { timeout: 30_000 }),
    ]).catch(() => {});
    // A one-page form can re-render in place; give it a moment to move on.
    await page
      .waitForURL((u) => onPortal(u.href, portal), { timeout: hasPass ? 15_000 : 3_000 })
      .catch(() => {});
    // The password went in once; anything but the portal now is a refusal
    // or an extra step, never a reason to type it again.
    if (hasPass) break;
  }
  if (!onPortal(page.url(), portal) && asksForCode(await bodyText(page)))
    await enterCode(page, portal, session);
  if (onPortal(page.url(), portal)) {
    await session?.save(JSON.stringify(await context.storageState()));
    return page;
  }

  const text = await bodyText(page);
  if (/incorrect|invalid|not (match|recognized|found)|try again|wrong/i.test(text))
    throw new SyncError("Login failed: check the Veracross username and password on the Accounts page.");
  throw new SyncError("Couldn't sign in to Veracross. Check the login on the Accounts page.");
}

type Child = { name: string; scheduleUrl: string };

async function findStudent(page: Page, portal: string, firstName: string | null): Promise<string> {
  if (!onPortal(page.url(), portal) || new URL(page.url()).pathname !== new URL(portal).pathname)
    await page.goto(portal, { waitUntil: "domcontentloaded" });
  // "My Children" is drawn by the page's scripts after it loads.
  await page.waitForSelector('a[href$="/daily-schedule"]').catch(() => {
    throw new SyncError("Signed in to Veracross, but no student's Daily Schedule is listed.");
  });
  const children: Child[] = await page.$$eval('a[href$="/daily-schedule"]', (links) => {
    const out: { name: string; scheduleUrl: string }[] = [];
    for (const a of links as HTMLAnchorElement[]) {
      let box: Element | null = a;
      while (box && box.querySelectorAll(".vx-child-name").length === 0) box = box.parentElement;
      const names = box ? box.querySelectorAll(".vx-child-name") : [];
      const name = names.length === 1 ? (names[0].textContent ?? "").trim() : "";
      if (!out.some((c) => c.scheduleUrl === a.href)) out.push({ name, scheduleUrl: a.href });
    }
    return out;
  });
  const wanted = firstName?.trim().toLowerCase();
  const match = wanted ? children.filter((c) => c.name.toLowerCase().split(/\s+/)[0] === wanted) : children;
  if (match.length === 1) return match[0].scheduleUrl.split("?")[0];
  if (wanted) throw new SyncError("The student named in the source settings isn't on this Veracross login.");
  throw new SyncError(
    "This Veracross login has more than one student; set the student's first name in the source settings.",
  );
}

// School days (Monday to Friday) from today, in the home time zone.
export function schoolDays(now: Date, tz: string, days = DAYS_AHEAD): string[] {
  const today = localDate(now, tz);
  return Array.from({ length: days }, (_, i) => addDays(today, i)).filter((d) => {
    const w = weekday(d);
    return w >= 1 && w <= 5;
  });
}

export async function fetchVeracross(ctx: AdapterContext): Promise<VeracrossRaw> {
  const cred = ctx.credential;
  if (!cred?.username || !cred.secret)
    throw new SyncError("No Veracross login is set. Add it on the Accounts page.");
  const config = ctx.source.config as VeracrossConfig;
  const portal = portalFrom(config.portalUrl);
  if (!portal) throw new SyncError("Set the parent portal link in the source settings.");
  const browser = await launch();
  try {
    const page = await signIn(browser, portal, cred.username, cred.secret, ctx.browserSession);
    const scheduleUrl = await findStudent(page, portal, config.studentFirstName ?? null);
    const days: VcDay[] = [];
    for (const date of schoolDays(ctx.now, ctx.homeTimeZone)) {
      await new Promise((r) => setTimeout(r, minGap()));
      const res = await page.context().request.get(`${scheduleUrl}?date=${date}`);
      if (!onPortal(res.url(), portal))
        throw new SyncError("Veracross signed us out while reading. It will be tried again next time.");
      if (!res.ok()) throw new SyncError(`Veracross answered with an error (${res.status()}).`);
      try {
        days.push(parseDailySchedule(await res.text(), date));
      } catch {
        throw new SyncError("Veracross's Daily Schedule page has changed, so this sync needs an update.");
      }
    }
    return { scheduleUrl, days };
  } finally {
    await browser.close().catch(() => {});
  }
}

// CRED-6 "Test connection": sign in only.
export async function testVeracrossLogin(
  portalUrl: string | undefined,
  username: string,
  password: string,
  session?: BrowserSession,
) {
  const portal = portalFrom(portalUrl);
  if (!portal) throw new SyncError("Add the Veracross source (with its portal link) first, then test.");
  const browser = await launch();
  try {
    await signIn(browser, portal, username, password, session);
  } finally {
    await browser.close().catch(() => {});
  }
}

export const veracrossAdapter: Adapter<VeracrossRaw> = {
  kind: "veracross",
  label: "Veracross (daily schedule)",
  credentialKinds: ["password"],
  fetchRaw: fetchVeracross,
  normalise: normaliseVeracross,
};
