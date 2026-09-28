import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { events, sources } from "@db/schema";
import { addDays, localDate, zonedToUtc } from "../../domain/time";
import type { DbOrTx } from "../db/client";
import { getHomeTimeZone } from "../settings";

// "Today at school" (SCH-1): the periods from Veracross for today, or for the
// next school day within a week once today's are over.

export type SchoolPeriod = {
  id: string;
  start: string;
  end: string;
  title: string;
  room: string | null;
  teachers: string | null;
  url: string | null;
};
export type SchoolDay = { date: string; today: boolean; periods: SchoolPeriod[]; timeZone: string };

const midnight = (date: string, tz: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return zonedToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, tz);
};

export async function loadSchoolDay(db: DbOrTx, now = new Date()): Promise<SchoolDay | null> {
  const tz = await getHomeTimeZone(db);
  const today = localDate(now, tz);
  const rows = await db
    .select({
      id: events.id,
      start: events.startUtc,
      end: events.endUtc,
      title: events.title,
      room: events.locationName,
      notes: events.notes,
      url: events.sourceUrl,
    })
    .from(events)
    .innerJoin(sources, eq(sources.id, events.sourceId))
    .where(
      and(
        eq(sources.kind, "veracross"),
        eq(sources.enabled, true),
        eq(events.category, "school_class"),
        eq(events.status, "active"),
        isNull(events.deletedAt),
        gte(events.startUtc, midnight(today, tz)),
        lt(events.startUtc, midnight(addDays(today, 8), tz)),
      ),
    )
    .orderBy(asc(events.startUtc));

  const byDate = new Map<string, typeof rows>();
  for (const r of rows) {
    const d = localDate(r.start, tz);
    byDate.set(d, [...(byDate.get(d) ?? []), r]);
  }
  // Today until its last period ends, then the next day with periods.
  const date = [...byDate.keys()].find(
    (d) => d !== today || byDate.get(d)!.some((r) => r.end.getTime() > now.getTime()),
  );
  if (!date) return null;
  return {
    date,
    today: date === today,
    timeZone: tz,
    periods: byDate.get(date)!.map((r) => ({
      id: r.id,
      start: r.start.toISOString(),
      end: r.end.toISOString(),
      title: r.title,
      room: r.room,
      teachers: r.notes?.replace(/^With /, "") ?? null,
      url: r.url,
    })),
  };
}
