import type { Attendance, Category } from "./constants";
import { localDate } from "./time";

// Clash detection (plan M1.9, spec CON-1, CON-2, CAL-7). Pure and fast: a
// sweep over events sorted by start, so two years of events take a few
// milliseconds (NFR-4 asks for under 200 ms).

export const DEFAULT_BUFFER_MIN = 15;

export type ClashEvent = {
  id: string;
  category: Category;
  attendance: Attendance;
  // Effective times, after any override.
  start: Date;
  end: Date;
  allDay: boolean;
  locationId: string | null;
  locationName: string | null;
};

export type Place = { id: string; match: string[] };
export type Buffers = Map<string, number>; // key `${a}|${b}` with a < b, minutes

export type Clash = {
  a: string;
  b: string; // a < b
  // overlap: the times overlap; travel: they don't, but there isn't enough
  // time to get from one place to the other.
  kind: "overlap" | "travel";
  gapMin: number;
  bufferMin: number;
};

export const pairKey = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

// Which known place an event is at: its chosen location, or the first place
// whose match text appears in the source's location text.
export function resolvePlace(e: ClashEvent, places: Place[]): string | null {
  if (e.locationId) return e.locationId;
  const text = e.locationName?.toLowerCase();
  if (!text) return null;
  return places.find((p) => p.match.some((m) => m && text.includes(m.toLowerCase())))?.id ?? null;
}

export function bufferBetween(pa: string | null, pb: string | null, buffers: Buffers): number {
  if (pa && pb && pa === pb) return 0;
  if (pa && pb) {
    const [x, y] = pairKey(pa, pb);
    return buffers.get(`${x}|${y}`) ?? DEFAULT_BUFFER_MIN;
  }
  return DEFAULT_BUFFER_MIN;
}

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
  places: Place[];
  buffers: Buffers;
  homeTimeZone: string;
};

export function detectClashes({ events, places, buffers, homeTimeZone }: ClashInput): Clash[] {
  const closed = closureDates(events, homeTimeZone);
  const maxBufferMs = Math.max(DEFAULT_BUFFER_MIN, ...buffers.values()) * 60_000;
  const candidates = events
    .filter((e) => needsJayden(e, closed, homeTimeZone))
    .map((e) => ({ e, place: resolvePlace(e, places), start: e.start.getTime(), end: e.end.getTime() }))
    .sort((x, y) => x.start - y.start);

  const clashes: Clash[] = [];
  let active: typeof candidates = [];
  for (const cur of candidates) {
    // Anything that ended more than the largest buffer ago can't clash.
    active = active.filter((a) => a.end + maxBufferMs > cur.start);
    for (const prev of active) {
      // Classes are the timetable itself; they don't clash with each other.
      if (prev.e.category === "school_class" && cur.e.category === "school_class") continue;
      const bufferMin = bufferBetween(prev.place, cur.place, buffers);
      const overlap = cur.start < prev.end && prev.start < cur.end;
      const gapMs = cur.start - prev.end;
      if (overlap || gapMs < bufferMin * 60_000) {
        const [a, b] = pairKey(prev.e.id, cur.e.id);
        clashes.push({
          a,
          b,
          kind: overlap ? "overlap" : "travel",
          gapMin: overlap ? 0 : Math.round(gapMs / 60_000),
          bufferMin,
        });
      }
    }
    active.push(cur);
  }
  return clashes;
}
