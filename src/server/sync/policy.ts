// Sync limits shared by the web app and the worker (SYNC-2, SYNC-5).

// Calendar feeds are made to be polled, so they refresh whenever asked
// (owner, 2026-09-30); a run already going still stops a second one.
export const FEED_KINDS: ReadonlySet<string> = new Set(["google_calendar", "ical"]);

// Scraped sites: at most one run per source per hour, on-demand included.
// Overridable for local development only.
export function minGapMs(kind: string): number {
  if (FEED_KINDS.has(kind)) return 0;
  const minutes = Number(process.env.SYNC_MIN_GAP_MINUTES ?? 60);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 60) * 60_000;
}

// A run still "running" after this long died without finishing (the worker
// job's own timeout is 30 minutes).
export const STALE_RUN_MS = 35 * 60_000;

// Per-source time budget, so one slow site can't hold up the others.
export const SOURCE_TIMEOUT_MS = 10 * 60_000;

export const FAILURE_ALERT_THRESHOLD = 3;
