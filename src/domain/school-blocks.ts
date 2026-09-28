import { localDate } from "./time";

// SCH-1: a school day's classes show as one "School" block on the calendar
// until it's expanded. A day with a single class needs no block.

type Timed = { category: string; allDay: boolean; start: string; end: string };

export type SchoolBlock<T> = { date: string; start: string; end: string; classes: T[] };

export function schoolBlocks<T extends Timed>(events: T[], tz: string): SchoolBlock<T>[] {
  const byDay = new Map<string, T[]>();
  for (const e of events) {
    if (e.category !== "school_class" || e.allDay) continue;
    const date = localDate(new Date(e.start), tz);
    byDay.set(date, [...(byDay.get(date) ?? []), e]);
  }
  const blocks: SchoolBlock<T>[] = [];
  for (const [date, classes] of byDay) {
    if (classes.length < 2) continue;
    classes.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const end = classes.reduce((m, c) => (Date.parse(c.end) > Date.parse(m) ? c.end : m), classes[0].end);
    blocks.push({ date, start: classes[0].start, end, classes });
  }
  return blocks.sort((a, b) => a.date.localeCompare(b.date));
}
