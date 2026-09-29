// intent 0004, API-6: the iPhone app sends `X-App-Version: 1.2.3`. A build
// older than MIN_APP_VERSION gets 426 and a "please update" message. No
// header (the website) is never too old.

const parts = (v: string) => (/^\d+(\.\d+){0,2}$/.test(v) ? v.split(".").map(Number) : null);

export function isAppTooOld(sent: string | null | undefined, minimum: string | null | undefined): boolean {
  if (!sent || !minimum) return false;
  const a = parts(sent.trim());
  const b = parts(minimum.trim());
  // An unreadable version is treated as too old, so the app says so.
  if (!b) return false;
  if (!a) return true;
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

export const UPDATE_MESSAGE = "This version of the app is too old. Install the latest build from TestFlight.";
