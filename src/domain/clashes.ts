import type { Attendance, Category } from "./constants";
import { localDate } from "./time";

// Clash detection (plan M1.9, spec CON-1, CON-2, CAL-7). Pure and fast: a
// sweep over events sorted by start, so two years of events take a few
// milliseconds (NFR-4 asks for under 200 ms).

// Two events clash only when they overlap by more than this. Back-to-back
// events, or ones that run a few minutes into each other, are fine.
export const CLASH_TOLERANCE_MIN = 15;

export type ClashEvent = {
  id: string;
  category: Category;
  attendance: Attendance;
  // Effective times, after any override.
  start: Date;
  end: Date;
  allDay: boolean;
};

export type Clash = {
  a: string;
  b: string; // a < b
  overlapMin: number;
};

export const pairKey = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

// School closure dates in the home time zone (CAL-7), from all-day or timed
// closure events.
export function closureDates(events: ClashEvent[], homeTz: string): Set<string> {
  const dates = new Set<string>();
  for (const e of events) {
    if (e.category !== "school_closure") continue;
    const day = (d: Date) => (e.allDay ? d.toISOString().slice(0, 10) : localDate(d, homeTz));
    const first = day(e.start);
    // End is exclusive for all-day events.
    const lastInstant = e.allDay ? new Date(e.end.getTime() - 1) : e.end;
    const last = day(lastInstant < e.start ? e.start : lastInstant);
    for (let d = first; d <= last; d = nextDay(d)) dates.add(d);
  }
  return dates;
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// Can this event take part in clashes at all?
function needsJayden(e: ClashEvent, closed: Set<string>, homeTz: string): boolean {
  if (e.attendance !== "required" || e.allDay || e.category === "school_closure") return false;
  // No classes on closure days (CAL-7).
  if (e.category === "school_class" && closed.has(localDate(e.start, homeTz))) return false;
  return true;
}

export type ClashInput = {
  events: ClashEvent[];
  homeTimeZone: string;
};

export function detectClashes({ events, homeTimeZone }: ClashInput): Clash[] {
  const closed = closureDates(events, homeTimeZone);
  const toleranceMs = CLASH_TOLERANCE_MIN * 60_000;
  const candidates = events
    .filter((e) => needsJayden(e, closed, homeTimeZone))
    .map((e) => ({ e, start: e.start.getTime(), end: e.end.getTime() }))
    .sort((x, y) => x.start - y.start);

  const clashes: Clash[] = [];
  let active: typeof candidates = [];
  for (const cur of candidates) {
    // Anything ending within the tolerance of this start can't overlap it enough.
    active = active.filter((a) => a.end - toleranceMs > cur.start);
    for (const prev of active) {
      // Classes are the timetable itself; they don't clash with each other.
      if (prev.e.category === "school_class" && cur.e.category === "school_class") continue;
      const overlapMs = Math.min(prev.end, cur.end) - cur.start;
      if (overlapMs > toleranceMs) {
        const [a, b] = pairKey(prev.e.id, cur.e.id);
        clashes.push({ a, b, overlapMin: Math.round(overlapMs / 60_000) });
      }
    }
    active.push(cur);
  }
  return clashes;
}
