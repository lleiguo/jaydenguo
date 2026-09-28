import { addDays } from "./time";
import { COURSES, STROKES, STROKE_LABEL, type Course, type Stroke } from "./swim-constants";

// Swimming maths that pages and the API share (SWM-3..6): event keys, time
// formatting, PB flags, change from the previous best, the PB table and
// progression series. An event is distance + stroke + course, so SCM and
// LCM swims are never compared or mixed (SWM-4).

export type SwimEvent = { distance: number; stroke: Stroke; course: Course };

export function eventKey(e: SwimEvent): string {
  return `${e.distance}-${e.stroke}-${e.course}`;
}

export function parseEventKey(key: string): SwimEvent | null {
  const m = /^(\d{2,4})-([a-z]+)-([A-Z]{3})$/.exec(key);
  if (!m) return null;
  const stroke = m[2] as Stroke;
  const course = m[3] as Course;
  if (!STROKES.includes(stroke) || !COURSES.includes(course)) return null;
  return { distance: Number(m[1]), stroke, course };
}

export function eventLabel(e: SwimEvent, withCourse = true): string {
  const base = `${e.distance} ${STROKE_LABEL[e.stroke]}`;
  return withCourse ? `${base} ${e.course}` : base;
}

const STROKE_ALIASES: Record<string, Stroke> = {
  free: "free",
  freestyle: "free",
  fr: "free",
  back: "back",
  backstroke: "back",
  bk: "back",
  breast: "breast",
  breaststroke: "breast",
  br: "breast",
  fly: "fly",
  butterfly: "fly",
  im: "im",
  medley: "im",
  "individual medley": "im",
};

export function normaliseStroke(s: string): Stroke | null {
  return STROKE_ALIASES[s.trim().toLowerCase()] ?? null;
}

export function normaliseCourse(s: string | null | undefined): Course | null {
  const c = (s ?? "").trim().toUpperCase();
  return (COURSES as readonly string[]).includes(c) ? (c as Course) : null;
}

// 34850 → "34.85", 68230 → "1:08.23". Swim times are shown to hundredths.
export function formatSwimTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const cs = Math.round(ms / 10);
  const minutes = Math.floor(cs / 6000);
  const seconds = Math.floor((cs % 6000) / 100);
  const hundredths = cs % 100;
  const ss = `${seconds}.${String(hundredths).padStart(2, "0")}`;
  return minutes ? `${minutes}:${ss.padStart(5, "0")}` : ss;
}

// Signed change, e.g. -1230 → "−1.23", 450 → "+0.45".
export function formatChange(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms === 0) return "±0.00";
  return `${ms < 0 ? "−" : "+"}${formatSwimTime(Math.abs(ms))}`;
}

// "1:08.23", "68.23", "34.8" or "34" → milliseconds; null if it isn't a
// plausible swim time.
export function parseSwimTime(text: string): number | null {
  const m = /^\s*(?:(\d{1,2}):)?(\d{1,2}|\d{1,3})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const minutes = m[1] ? Number(m[1]) : 0;
  const seconds = Number(m[2]);
  if (m[1] && seconds >= 60) return null;
  const frac = m[3] ? Number(m[3].padEnd(2, "0")) : 0;
  const ms = (minutes * 60 + seconds) * 1000 + frac * 10;
  return ms > 0 && ms < 60 * 60 * 1000 ? ms : null;
}

// A session start as Commit Swimming writes it ("08:50AM", "4:30 pm") →
// "08:50" / "16:30"; null if it isn't a time.
export function sessionTime(text: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(?:([ap])\.?m\.?)?\s*$/i.exec(text ?? "");
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
  } else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

// The date an entry swims: the meet's first day, plus (day - 1).
export function sessionDate(startDate: string, meetDay: number | null): string {
  return meetDay && meetDay > 1 ? addDays(startDate, meetDay - 1) : startDate;
}

// "Sat 2024-04-28 16:30", for a session on the meet pages.
export function formatSession(s: { date: string; time: string }): string {
  const day = new Date(`${s.date}T12:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${day} ${s.date} ${s.time}`;
}

// Heats before semis before finals on the same day.
const STAGE_ORDER: Record<string, number> = { prelim: 0, heat: 0, heats: 0, semi: 1, semifinal: 1, final: 2 };
const stageRank = (stage: string | null | undefined) =>
  STAGE_ORDER[(stage ?? "").trim().toLowerCase().replace(/s$/, "")] ?? 1;

export type SwimForStats = SwimEvent & {
  id: string;
  swimDate: string; // YYYY-MM-DD
  timeMs: number | null;
  stage?: string | null;
};

export type PbInfo = {
  // A new best for this event and course (the first swim counts).
  isPb: boolean;
  // The best before this swim, and this swim minus it (negative = faster).
  previousBestMs: number | null;
  changeMs: number | null;
};

function chronological<T extends SwimForStats>(swims: T[]): T[] {
  return [...swims].sort(
    (a, b) =>
      a.swimDate.localeCompare(b.swimDate) ||
      stageRank(a.stage) - stageRank(b.stage) ||
      a.id.localeCompare(b.id),
  );
}

export function groupByEvent<T extends SwimForStats>(swims: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const s of chronological(swims)) {
    const key = eventKey(s);
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  return groups;
}

// SWM-3: PB flag and change from the previous best, per swim.
export function annotatePbs(swims: SwimForStats[]): Map<string, PbInfo> {
  const out = new Map<string, PbInfo>();
  for (const list of groupByEvent(swims).values()) {
    let best: number | null = null;
    for (const s of list) {
      if (s.timeMs == null) {
        out.set(s.id, { isPb: false, previousBestMs: best, changeMs: null });
        continue;
      }
      out.set(s.id, {
        isPb: best === null || s.timeMs < best,
        previousBestMs: best,
        changeMs: best === null ? null : s.timeMs - best,
      });
      if (best === null || s.timeMs < best) best = s.timeMs;
    }
  }
  return out;
}

export type PersonalBest = SwimEvent & { key: string; timeMs: number; swimDate: string; resultId: string };

// SWM-6: the current best per event and course (the earliest swim on a tie).
export function personalBests(swims: SwimForStats[]): PersonalBest[] {
  const out: PersonalBest[] = [];
  for (const [key, list] of groupByEvent(swims)) {
    let best: SwimForStats | null = null;
    for (const s of list) if (s.timeMs != null && (best === null || s.timeMs < best.timeMs!)) best = s;
    if (best)
      out.push({
        key,
        distance: best.distance,
        stroke: best.stroke,
        course: best.course,
        timeMs: best.timeMs!,
        swimDate: best.swimDate,
        resultId: best.id,
      });
  }
  const strokeOrder = (s: Stroke) => STROKES.indexOf(s);
  return out.sort(
    (a, b) =>
      COURSES.indexOf(a.course) - COURSES.indexOf(b.course) ||
      strokeOrder(a.stroke) - strokeOrder(b.stroke) ||
      a.distance - b.distance,
  );
}

export type ProgressionPoint = { id: string; swimDate: string; timeMs: number; isPb: boolean };

// SWM-4: every timed swim of one event and course, plus the PB line that
// steps down each time a new best is set.
export function progression(
  swims: SwimForStats[],
  event: SwimEvent,
): { points: ProgressionPoint[]; pbSteps: { swimDate: string; timeMs: number }[] } {
  const key = eventKey(event);
  const list = chronological(swims.filter((s) => eventKey(s) === key && s.timeMs != null));
  const pbs = annotatePbs(list);
  const points = list.map((s) => ({
    id: s.id,
    swimDate: s.swimDate,
    timeMs: s.timeMs!,
    isPb: pbs.get(s.id)!.isPb,
  }));
  return {
    points,
    pbSteps: points.filter((p) => p.isPb).map(({ swimDate, timeMs }) => ({ swimDate, timeMs })),
  };
}
