import type { Browser, Page } from "playwright-core";
import { USER_AGENT } from "../http";
import { SyncError, type Adapter, type AdapterContext } from "../types";
import { extractInPage, type CommitRaw } from "./extract";
import { normaliseCommit } from "./normalise";

// Commit Swimming (SRC-6, plan M2.3): signs in with the owner's stored login
// in headless Chromium, then reads meets, entries and results through the
// site's own pages (spikes.md SP-3). Polite (SYNC-5): images and fonts are
// not loaded, method calls are 2 s apart, and the browser identifies the app.

const DEFAULT_BASE = "https://team.commitswimming.com";
const minGap = () => Number(process.env.FETCH_MIN_GAP_MS ?? 2000);

// Tests point this at a local fake of the site. Only loopback addresses are
// accepted, so a stray setting can never send the login anywhere else.
export function commitBaseUrl(): string {
  const override = process.env.COMMIT_SWIM_BASE_URL;
  if (!override) return DEFAULT_BASE;
  const u = new URL(override);
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost")
    throw new Error("COMMIT_SWIM_BASE_URL must be a loopback address");
  return u.origin;
}

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  try {
    return await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  } catch {
    throw new SyncError("The sync browser couldn't start. It will be tried again next time.");
  }
}

const LOGIN_PROBLEMS: [RegExp, string][] = [
  [/2fa|two.?factor|code/i, "Commit Swimming asks for a sign-in code, so automatic sync can't sign in."],
  [
    /user not found|incorrect password|match failed|not found/i,
    "Login failed: check your Commit Swimming email and password.",
  ],
  [
    /too many|rate/i,
    "Commit Swimming is refusing sign-ins for now (too many attempts). It will be tried again next time.",
  ],
];

// Opens the site and signs in. Returns the signed-in page.
export async function signIn(browser: Browser, username: string, password: string): Promise<Page> {
  const version = browser.version();
  const context = await browser.newContext({
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 ${USER_AGENT}`,
  });
  // tsx/esbuild can wrap functions in a `__name` helper that doesn't exist
  // in the page; define it so page.evaluate works in development too.
  await context.addInitScript("globalThis.__name ??= (f) => f;");
  await context.route(/\.(png|jpe?g|gif|webp|svg|woff2?|ttf|mp4)(\?|$)/i, (route) => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const base = commitBaseUrl();
  try {
    await page.goto(`${base}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const m = (
        globalThis as { Meteor?: { loginWithPassword?: unknown; status?: () => { connected: boolean } } }
      ).Meteor;
      return !!m?.loginWithPassword && !!m.status?.().connected;
    });
  } catch {
    throw new SyncError(
      "Commit Swimming didn't load. The site may be down; it will be tried again next time.",
    );
  }
  const outcome = await page.evaluate(
    ({ u, p }) =>
      new Promise<{ ok: true } | { ok: false; reason: string }>((resolve) => {
        const m = (
          globalThis as unknown as {
            Meteor: {
              loginWithPassword: (
                u: string,
                p: string,
                cb: (e?: { reason?: string; error?: unknown }) => void,
              ) => void;
            };
          }
        ).Meteor;
        m.loginWithPassword(u, p, (err) =>
          resolve(err ? { ok: false, reason: String(err.reason ?? err.error ?? "unknown") } : { ok: true }),
        );
      }),
    { u: username, p: password },
  );
  if (!outcome.ok) {
    const known = LOGIN_PROBLEMS.find(([re]) => re.test(outcome.reason));
    throw new SyncError(
      known?.[1] ?? "Commit Swimming refused the sign-in. Check the login on the Accounts page.",
    );
  }
  try {
    await page.waitForURL(/\/app\/[^/]+/, { timeout: 30_000 });
  } catch {
    // Signed in, but the app didn't route on: open it directly.
    await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/app\/[^/]+/, { timeout: 30_000 }).catch(() => {
      throw new SyncError("Signed in to Commit Swimming, but no team page opened. Is this login on a team?");
    });
  }
  return page;
}

const EXTRACT_PROBLEMS: Record<string, string> = {
  "signed-out": "Commit Swimming signed us out while reading. It will be tried again next time.",
  "not-meteor":
    "Commit Swimming's pages have changed, so this sync needs an update. Add results by hand meanwhile.",
  "no-team": "Signed in to Commit Swimming, but no team page opened. Is this login on a team?",
  "no-athlete": "This Commit Swimming login has no swimmer linked to it.",
  "many-athletes":
    "This Commit Swimming login has more than one swimmer; set the swimmer's first name in the source settings.",
  "athlete-not-found": "The swimmer named in the source settings isn't on this Commit Swimming login.",
};

export async function fetchCommit(ctx: AdapterContext): Promise<CommitRaw> {
  const cred = ctx.credential;
  if (!cred?.username || !cred.secret)
    throw new SyncError("No Commit Swimming login is set. Add it on the Accounts page.");
  const athleteFirstName =
    typeof ctx.source.config.athleteFirstName === "string" ? ctx.source.config.athleteFirstName : null;
  const browser = await launch();
  try {
    const page = await signIn(browser, cred.username, cred.secret);
    // The dashboard subscribes to what the extractor needs.
    const dashboard = page.url().replace(/(\/app\/[^/]+).*$/, "$1/dashboard");
    if (page.url() !== dashboard) await page.goto(dashboard, { waitUntil: "domcontentloaded" });
    let result;
    try {
      result = await page.evaluate(extractInPage, { athleteFirstName, gapMs: minGap() });
    } catch {
      throw new SyncError(
        "Commit Swimming's pages have changed, so this sync needs an update. Add results by hand meanwhile.",
      );
    }
    if (!result.ok)
      throw new SyncError(EXTRACT_PROBLEMS[result.problem] ?? "Reading Commit Swimming failed.");
    return result.raw;
  } finally {
    await browser.close().catch(() => {});
  }
}

// CRED-6 "Test connection": sign in only.
export async function testCommitLogin(username: string, password: string): Promise<void> {
  const browser = await launch();
  try {
    await signIn(browser, username, password);
  } finally {
    await browser.close().catch(() => {});
  }
}

export const commitSwimAdapter: Adapter<CommitRaw> = {
  kind: "commit_swim",
  label: "Commit Swimming",
  credentialKinds: ["password"],
  fetchRaw: fetchCommit,
  normalise: normaliseCommit,
};
