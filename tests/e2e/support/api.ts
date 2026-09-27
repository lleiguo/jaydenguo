import type { BrowserContext } from "@playwright/test";
import { APP_URL } from "./env";
import { FAKE_OIDC_PORT } from "./fake-oidc-port";

// JSON calls to the site's API as the signed-in browser, from the site's
// own origin (the CSRF check requires it).
export async function apiSend(context: BrowserContext, method: string, path: string, data?: unknown) {
  const res = await context.request.fetch(path, { method, data, headers: { origin: APP_URL } });
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
  return res.status() === 204 ? null : res.json();
}

export const fakeFeed = (name: string) => `http://127.0.0.1:${FAKE_OIDC_PORT}/ical/${name}`;

export async function addFeedCredential(
  context: BrowserContext,
  label: string,
  feed: string,
): Promise<string> {
  const cred = await apiSend(context, "POST", "/api/v1/credentials", {
    kind: "secret_url",
    provider: "teamsnap",
    label,
    secret: fakeFeed(feed),
  });
  return cred.id;
}
