// Polite HTTP for source adapters (spec SYNC-5): one user agent that
// identifies the app, a timeout, and at least 2 s between requests to the
// same host.

export const USER_AGENT = "FamilyHub/1.0 (private family calendar; one request at a time)";
// Tests set FETCH_MIN_GAP_MS=0; production always uses the default.
const minGap = () => Number(process.env.FETCH_MIN_GAP_MS ?? 2000);
const lastRequestAt = new Map<string, number>();

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

// webcal:// (and webcals://) is https:// with a different name.
export function normaliseFeedUrl(url: string): URL {
  const u = new URL(url.replace(/\s+/g, "").replace(/^webcals?:\/\//i, "https://"));
  if (u.protocol !== "https:" && u.protocol !== "http:")
    throw new FetchError("Only web links can be fetched");
  return u;
}

export async function politeFetch(url: URL, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const wait = (lastRequestAt.get(url.host) ?? 0) + minGap() - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(url.host, Date.now());
  try {
    return await fetch(url, {
      ...init,
      headers: { "user-agent": USER_AGENT, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError")
      throw new FetchError("The site took too long to answer");
    throw new FetchError("Couldn't reach the site");
  }
}
