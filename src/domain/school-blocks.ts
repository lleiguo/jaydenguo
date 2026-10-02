import { localDate } from "./time";

// SCH-1: a school day's classes show as one "School" block on the calendar
// until it's expanded. A day with a single class needs no block. Each child
// has his own block (owner, 2026-10-01): brothers' timetables don't mix.

type Timed = { category: string; allDay: boolean; start: string; end: string; owners: string[] };

export type SchoolBlock<T> = {
  // Date and owners: one block per child per day.
  key: string;
  date: string;
  owners: string[];
  start: string;
  end: string;
  classes: T[];
};

export function schoolBlocks<T extends Timed>(events: T[], tz: string): SchoolBlock<T>[] {
  const byKey = new Map<string, T[]>();
  for (const e of events) {
    if (e.category !== "school_class" || e.allDay) continue;
    const key = `${localDate(new Date(e.start), tz)}:${[...e.owners].sort().join("+")}`;
    byKey.set(key, [...(byKey.get(key) ?? []), e]);
  }
  const blocks: SchoolBlock<T>[] = [];
  for (const [key, classes] of byKey) {
    if (classes.length < 2) continue;
    classes.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const end = classes.reduce((m, c) => (Date.parse(c.end) > Date.parse(m) ? c.end : m), classes[0].end);
    blocks.push({
      key,
      date: key.slice(0, 10),
      owners: classes[0].owners,
      start: classes[0].start,
      end,
      classes,
    });
  }
  return blocks.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}
