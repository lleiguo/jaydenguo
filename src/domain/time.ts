// Time-zone arithmetic without a library (CAL-9). Times are stored in UTC and
// shown in the home time zone; wall-clock times from sources and repeating
// events are converted here, so daylight-saving changes land correctly.

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

// The wall-clock time in `tz` at instant `d`.
export function wallClock(d: Date, tz: string): WallClock {
  const p = Object.fromEntries(
    formatter(tz)
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    second: +p.second,
  };
}

function offsetMs(d: Date, tz: string): number {
  const w = wallClock(d, tz);
  return (
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(d.getTime() / 1000) * 1000
  );
}

// The instant when the clock in `tz` shows `w`. In the spring-forward gap the
// time is pushed forward; in the fall-back overlap the earlier one is used.
export function zonedToUtc(w: WallClock, tz: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const first = guess - offsetMs(new Date(guess), tz);
  const second = guess - offsetMs(new Date(first), tz);
  if (first === second) return new Date(first);
  // Two candidates: prefer the earlier one that round-trips.
  const ok = [Math.min(first, second), Math.max(first, second)].find((t) => {
    const back = wallClock(new Date(t), tz);
    return back.hour === w.hour && back.minute === w.minute;
  });
  return new Date(ok ?? Math.max(first, second));
}

// "YYYY-MM-DD" of instant `d` in `tz`.
export function localDate(d: Date, tz: string): string {
  const w = wallClock(d, tz);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
