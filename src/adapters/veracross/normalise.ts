import { categorise } from "../../domain/categories";
import { addDays, zonedToUtc } from "../../domain/time";
import type { SourceRecord } from "../../domain/upsert";
import type { AdapterContext, NormalisedBatch } from "../types";
import type { VcDay } from "./parse";

// Daily Schedule days → school_class events (SCH-1). The page shows start
// times only: a period ends when a later one starts, and the day's last
// period gets the day's most common period length.

export type VeracrossRaw = {
  // The Daily Schedule link for a date, for links back (SCH-5).
  scheduleUrl: string;
  // Every weekday read, in order, including days without classes.
  days: VcDay[];
};

const FALLBACK_MINUTES = 45;

const at = (date: string, hhmm: string, tz: string) => {
  const [hour, minute] = hhmm.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  return zonedToUtc({ year, month, day, hour, minute, second: 0 }, tz);
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

function typicalMinutes(gaps: number[]): number {
  const counts = new Map<number, number>();
  for (const g of gaps) counts.set(g, (counts.get(g) ?? 0) + 1);
  let best = FALLBACK_MINUTES;
  let n = 0;
  for (const [g, c] of counts) if (c > n || (c === n && g > best)) [best, n] = [g, c];
  return best;
}

export function normaliseVeracross(raw: VeracrossRaw, ctx: AdapterContext): NormalisedBatch {
  const tz = ctx.homeTimeZone;
  const records: SourceRecord[] = [];
  for (const day of raw.days) {
    const starts = day.periods.map((p) => at(day.date, p.start, tz));
    const later = (i: number) => starts.slice(i + 1).find((s) => s > starts[i]);
    const gaps = starts
      .map((s, i) => later(i) && (later(i)!.getTime() - s.getTime()) / 60_000)
      .filter((g): g is number => !!g && g <= 120);
    const lastMinutes = typicalMinutes(gaps);
    day.periods.forEach((p, i) => {
      const { category, attendance } = categorise(p.description, ctx.source.mapping);
      records.push({
        externalId: `${day.date}T${p.start}:${slug(p.description)}`,
        category,
        attendance,
        title: p.description,
        notes: p.teachers.length ? `With ${p.teachers.join(", ")}` : null,
        locationName: p.room,
        startUtc: starts[i],
        endUtc: later(i) ?? new Date(starts[i].getTime() + lastMinutes * 60_000),
        allDay: false,
        sourceUrl: `${raw.scheduleUrl}?date=${day.date}`,
      });
    });
  }
  // Only the days read can lose periods; earlier days stay as history.
  const first = raw.days[0]?.date;
  const last = raw.days.at(-1)?.date;
  const window =
    first && last
      ? { from: at(first, "00:00", tz), to: at(addDays(last, 1), "00:00", tz) }
      : { from: ctx.now, to: ctx.now };
  const warnings = raw.days.some((d) => d.periods.length)
    ? []
    : ["No classes were found in the next two weeks."];
  return { records, window, warnings };
}
