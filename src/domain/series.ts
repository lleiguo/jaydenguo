import type { Attendance, Category } from "./constants";
import { addDays, weekday, zonedToUtc } from "./time";
import type { SourceRecord } from "./upsert";

// Manual repeating events (CAL-5): weekly or every N weeks on chosen
// weekdays, from a start date until an optional end date. Each occurrence
// keeps the same local start time in the series' time zone, across
// daylight-saving changes (CAL-9).

export type SeriesRule = {
  title: string;
  category: Category;
  notes: string | null;
  locationName: string | null;
  attendance: Attendance;
  ownerIds?: string[];
  allDay: boolean;
  startDate: string; // YYYY-MM-DD
  untilDate: string | null;
  startTime: string; // HH:MM
  durationMin: number;
  timeZone: string;
  intervalWeeks: number;
  weekdays: number[]; // 0 = Sunday
};

// Open-ended series are written out this far ahead; a daily job extends them.
export const SERIES_HORIZON_DAYS = 730;

export function expandSeries(rule: SeriesRule, today: string): SourceRecord[] {
  const horizon = addDays(today, SERIES_HORIZON_DAYS);
  const last = rule.untilDate && rule.untilDate < horizon ? rule.untilDate : horizon;
  const [hour, minute] = rule.startTime.split(":").map(Number);
  const days = new Set(rule.weekdays);
  // Weeks are counted from the Sunday of the start date's week.
  const firstSunday = addDays(rule.startDate, -weekday(rule.startDate));
  const out: SourceRecord[] = [];
  for (let date = rule.startDate; date <= last; date = addDays(date, 1)) {
    if (!days.has(weekday(date))) continue;
    const weeks = Math.floor((Date.parse(date) - Date.parse(firstSunday)) / (7 * 86_400_000));
    if (weeks % rule.intervalWeeks !== 0) continue;
    const [y, m, d] = date.split("-").map(Number);
    const startUtc = rule.allDay
      ? new Date(`${date}T00:00:00Z`)
      : zonedToUtc({ year: y, month: m, day: d, hour, minute, second: 0 }, rule.timeZone);
    const endUtc = rule.allDay
      ? new Date(`${addDays(date, Math.max(1, Math.round(rule.durationMin / 1440)))}T00:00:00Z`)
      : new Date(startUtc.getTime() + rule.durationMin * 60_000);
    out.push({
      externalId: date,
      title: rule.title,
      category: rule.category,
      notes: rule.notes,
      locationName: rule.locationName,
      attendance: rule.attendance,
      ownerIds: rule.ownerIds,
      allDay: rule.allDay,
      startUtc,
      endUtc,
      sourceUrl: null,
    });
  }
  return out;
}
