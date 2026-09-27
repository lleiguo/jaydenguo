import { and, desc, eq, gt, isNotNull, isNull, lt, max, sql } from "drizzle-orm";
import {
  changeLog,
  conflicts,
  eventOverrides,
  events,
  locationBuffers,
  locations,
  sources,
} from "@db/schema";
import { closureDates, detectClashes, type ClashEvent } from "../../domain/clashes";
import type { Attendance, Category } from "../../domain/constants";
import { localDate } from "../../domain/time";
import type { CalendarPayload, ClashView, EventView } from "../../lib/calendar-types";
import type { DbOrTx } from "../db/client";
import { getHomeTimeZone } from "../settings";

// Reads the calendar for a date range (plan M1.8-M1.9): events with any
// override applied, clashes, closure days and the live-update cursor.

const effStart = sql<Date>`coalesce(${eventOverrides.newStartUtc}, ${events.startUtc})`;
const effEnd = sql<Date>`coalesce(${eventOverrides.newEndUtc}, ${events.endUtc})`;

type Row = {
  event: typeof events.$inferSelect;
  override: typeof eventOverrides.$inferSelect | null;
  source: { id: string; name: string; kind: string } | null;
};

function baseQuery(db: DbOrTx) {
  return db
    .select({
      event: events,
      override: eventOverrides,
      source: { id: sources.id, name: sources.name, kind: sources.kind },
    })
    .from(events)
    .leftJoin(eventOverrides, and(eq(eventOverrides.eventId, events.id), isNull(eventOverrides.clearedAt)))
    .leftJoin(sources, eq(sources.id, events.sourceId));
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

function toView(r: Row, closed: Set<string>, homeTz: string): EventView {
  const e = r.event;
  const o = r.override;
  const start = o?.newStartUtc ?? e.startUtc;
  const end = o?.newEndUtc ?? e.endUtc;
  const snap = o?.sourceSnapshot as { start: string; end: string; title: string } | null | undefined;
  return {
    id: e.id,
    title: e.title,
    category: e.category as Category,
    attendance: e.attendance as Attendance,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: e.allDay,
    status: e.status as EventView["status"],
    deletedAt: iso(e.deletedAt),
    notes: e.notes,
    locationName: e.locationName,
    sourceUrl: e.sourceUrl,
    source: r.source?.id ? r.source : null,
    seriesId: e.seriesId,
    lastSyncedAt: iso(e.lastSyncedAt),
    override: o
      ? {
          id: o.id,
          skip: o.skip,
          moved: !!o.newStartUtc,
          originalStart: e.startUtc.toISOString(),
          originalEnd: e.endUtc.toISOString(),
          sourceChangedAt: iso(o.sourceChangedAt),
          snapshot: snap ?? null,
          createdBy: o.createdBy,
          createdAt: o.createdAt.toISOString(),
        }
      : null,
    schoolClosed:
      !e.allDay &&
      !["school_class", "school_closure"].includes(e.category) &&
      closed.has(localDate(start, homeTz)),
  };
}

export async function currentCursor(db: DbOrTx): Promise<number> {
  const [row] = await db.select({ seq: max(changeLog.seq) }).from(changeLog);
  return row?.seq ?? 0;
}

export async function loadPlaces(db: DbOrTx) {
  const places = await db.select({ id: locations.id, match: locations.match }).from(locations);
  const buffers = new Map(
    (await db.select().from(locationBuffers)).map((b) => [`${b.fromId}|${b.toId}`, b.minutes] as const),
  );
  return { places, buffers };
}

export async function loadCalendar(db: DbOrTx, from: Date, to: Date): Promise<CalendarPayload> {
  const cursor = await currentCursor(db);
  const homeTimeZone = await getHomeTimeZone(db);
  // A day either side, so travel buffers and closures at the edges count.
  const lo = new Date(from.getTime() - 86_400_000);
  const hi = new Date(to.getTime() + 86_400_000);
  const rows: Row[] = await baseQuery(db)
    .where(and(isNull(events.deletedAt), lt(effStart, hi), gt(effEnd, lo)))
    .orderBy(effStart, events.id);

  const clashEvents: ClashEvent[] = rows
    .filter((r) => r.event.status === "active" && !r.override?.skip)
    .map((r) => ({
      id: r.event.id,
      category: r.event.category as Category,
      attendance: r.event.attendance as Attendance,
      start: r.override?.newStartUtc ?? r.event.startUtc,
      end: r.override?.newEndUtc ?? r.event.endUtc,
      allDay: r.event.allDay,
      locationId: r.event.locationId,
      locationName: r.event.locationName,
    }));
  const closed = closureDates(clashEvents, homeTimeZone);
  const { places, buffers } = await loadPlaces(db);
  const accepted = await db
    .select({ id: conflicts.id, a: conflicts.eventA, b: conflicts.eventB })
    .from(conflicts)
    .where(isNull(conflicts.undoneAt));
  const acceptedByPair = new Map(accepted.map((c) => [`${c.a}|${c.b}`, c.id]));
  const clashes: ClashView[] = detectClashes({ events: clashEvents, places, buffers, homeTimeZone }).map(
    (c) => ({
      ...c,
      acceptedId: acceptedByPair.get(`${c.a}|${c.b}`) ?? null,
    }),
  );

  const inRange = rows.filter((r) => {
    const s = r.override?.newStartUtc ?? r.event.startUtc;
    const e = r.override?.newEndUtc ?? r.event.endUtc;
    return s < to && e > from;
  });
  const ids = new Set(inRange.map((r) => r.event.id));
  // Clashes with events just outside the range still show on the event
  // inside it; the client receives the other event too.
  const partners = new Set(clashes.flatMap((c) => [c.a, c.b]).filter((id) => !ids.has(id)));
  const shown = [...inRange, ...rows.filter((r) => partners.has(r.event.id))];

  return {
    events: shown.map((r) => toView(r, closed, homeTimeZone)),
    clashes,
    closures: [...closed].sort(),
    homeTimeZone,
    cursor,
  };
}

export async function loadEvent(db: DbOrTx, id: string): Promise<EventView | null> {
  const [row] = await baseQuery(db).where(eq(events.id, id));
  if (!row) return null;
  const homeTz = await getHomeTimeZone(db);
  return toView(row, new Set(), homeTz);
}

// The "Deleted" view (CAL-6): manual events that can be restored.
export async function loadDeleted(db: DbOrTx): Promise<EventView[]> {
  const rows = await baseQuery(db)
    .where(isNotNull(events.deletedAt))
    .orderBy(desc(events.deletedAt))
    .limit(200);
  const homeTz = await getHomeTimeZone(db);
  return rows.map((r) => toView(r, new Set(), homeTz));
}
