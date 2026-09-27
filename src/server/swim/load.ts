import { and, eq, isNull } from "drizzle-orm";
import { swimEntries, swimMeets, swimResults } from "@db/schema";
import {
  annotatePbs,
  eventKey,
  parseEventKey,
  personalBests,
  progression,
  type SwimEvent,
} from "../../domain/swim";
import type { Course, Stroke } from "../../domain/swim-constants";
import { forecast, type Forecast } from "../../domain/swim-forecast";
import type { SwimResultValues, SwimSplit } from "../../domain/swim-upsert";
import { localDate } from "../../domain/time";
import type { DbOrTx } from "../db/client";
import { getHomeTimeZone } from "../settings";

// Read models for the swimming pages and /api/v1/swim (SWM-2..6). The data
// is small (hundreds of swims), so PBs are worked out in memory each time.

export type ResultView = SwimEvent & {
  id: string;
  key: string;
  meetId: string | null;
  meetName: string | null;
  swimDate: string;
  timeMs: number | null;
  place: number | null;
  heat: number | null;
  lane: number | null;
  stage: string | null;
  dqReason: string | null;
  splits: SwimSplit[];
  notes: string | null;
  origin: "source" | "manual";
  corrected: boolean;
  sourceDisagrees: boolean;
  // The source's time and DQ, when it disagrees; null if it no longer lists
  // the swim.
  source: { timeMs: number | null; dqReason: string | null } | null;
  isPb: boolean;
  previousBestMs: number | null;
  changeMs: number | null;
};

export type MeetView = {
  id: string;
  name: string;
  course: Course | null;
  startDate: string;
  endDate: string;
  venue: string | null;
  city: string | null;
  signup: "yes" | "no" | null;
  sourceUrl: string | null;
  manual: boolean;
  entries: (SwimEvent & { key: string; seedTimeMs: number | null })[];
  swims: number;
  pbs: number;
};

async function allResults(db: DbOrTx): Promise<ResultView[]> {
  const rows = await db
    .select({ r: swimResults, meetName: swimMeets.name })
    .from(swimResults)
    .leftJoin(swimMeets, eq(swimMeets.id, swimResults.meetId))
    .where(and(eq(swimResults.status, "active"), isNull(swimResults.deletedAt)));
  const views = rows.map(({ r, meetName }) => {
    const source = r.sourceValues as SwimResultValues | null;
    const e = { distance: r.distance, stroke: r.stroke as Stroke, course: r.course as Course };
    return {
      ...e,
      id: r.id,
      key: eventKey(e),
      meetId: r.meetId,
      meetName,
      swimDate: r.swimDate,
      timeMs: r.timeMs,
      place: r.place,
      heat: r.heat,
      lane: r.lane,
      stage: r.stage,
      dqReason: r.dqReason,
      splits: (r.splits ?? []) as SwimSplit[],
      notes: r.notes,
      origin: r.origin as "source" | "manual",
      corrected: r.correctedAt !== null,
      sourceDisagrees: r.sourceDisagrees,
      source: source ? { timeMs: source.timeMs, dqReason: source.dqReason } : null,
      isPb: false,
      previousBestMs: null,
      changeMs: null,
    } satisfies ResultView;
  });
  const pbs = annotatePbs(views);
  return views
    .map((v) => ({ ...v, ...pbs.get(v.id)! }))
    .sort((a, b) => b.swimDate.localeCompare(a.swimDate) || a.key.localeCompare(b.key));
}

export async function listResults(db: DbOrTx): Promise<ResultView[]> {
  return allResults(db);
}

export async function listMeets(
  db: DbOrTx,
): Promise<{ today: string; upcoming: MeetView[]; past: MeetView[] }> {
  const today = localDate(new Date(), await getHomeTimeZone(db));
  const [meets, entries, results] = await Promise.all([
    db
      .select()
      .from(swimMeets)
      .where(and(eq(swimMeets.status, "active"), isNull(swimMeets.deletedAt))),
    db.select().from(swimEntries).where(eq(swimEntries.status, "active")),
    allResults(db),
  ]);
  const views: MeetView[] = meets.map((m) => {
    const mine = results.filter((r) => r.meetId === m.id);
    return {
      id: m.id,
      name: m.name,
      course: m.course as Course | null,
      startDate: m.startDate,
      endDate: m.endDate,
      venue: m.venue,
      city: m.city,
      signup: m.signup as MeetView["signup"],
      sourceUrl: m.sourceUrl,
      manual: m.sourceId === null,
      entries: entries
        .filter((e) => e.meetId === m.id)
        .map((e) => {
          const ev = { distance: e.distance, stroke: e.stroke as Stroke, course: e.course as Course };
          return { ...ev, key: eventKey(ev), seedTimeMs: e.seedTimeMs };
        }),
      swims: mine.length,
      pbs: mine.filter((r) => r.isPb).length,
    };
  });
  return {
    today,
    upcoming: views.filter((m) => m.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate)),
    past: views.filter((m) => m.endDate < today).sort((a, b) => b.startDate.localeCompare(a.startDate)),
  };
}

export async function loadMeet(db: DbOrTx, id: string) {
  const { upcoming, past } = await listMeets(db);
  const meet = [...upcoming, ...past].find((m) => m.id === id);
  if (!meet) return null;
  const results = (await allResults(db))
    .filter((r) => r.meetId === id)
    .sort((a, b) => a.swimDate.localeCompare(b.swimDate) || a.key.localeCompare(b.key));
  return { meet, results };
}

export async function loadPersonalBests(db: DbOrTx) {
  const results = await allResults(db);
  const byId = new Map(results.map((r) => [r.id, r]));
  return personalBests(results).map((pb) => ({
    ...pb,
    meetId: byId.get(pb.resultId)?.meetId ?? null,
    meetName: byId.get(pb.resultId)?.meetName ?? null,
    swims: results.filter((r) => r.key === pb.key && r.timeMs != null).length,
  }));
}

export type EventDetail = {
  event: SwimEvent;
  key: string;
  swims: ResultView[];
  points: ReturnType<typeof progression>["points"];
  pbSteps: ReturnType<typeof progression>["pbSteps"];
  forecast: Forecast;
  today: string;
};

export async function loadEvent(db: DbOrTx, key: string): Promise<EventDetail | null> {
  const event = parseEventKey(key);
  if (!event) return null;
  const today = localDate(new Date(), await getHomeTimeZone(db));
  const swims = (await allResults(db)).filter((r) => r.key === key);
  const { points, pbSteps } = progression(swims, event);
  return {
    event,
    key,
    swims,
    points,
    pbSteps,
    forecast: forecast(
      points.map((p) => ({ swimDate: p.swimDate, timeMs: p.timeMs })),
      today,
    ),
    today,
  };
}
