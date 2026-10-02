import type { CalendarPayload, ClashView, EventView } from "@/lib/calendar-types";
import { addDays, localDate, zonedToUtc } from "../domain/time";
import type { Person } from "../domain/people";
import { loadCalendar } from "./calendar/load";
import { loadSchoolDays, type SchoolDay } from "./calendar/school-day";
import type { Db } from "./db/client";
import { pendingCount } from "./email/suggestions";
import { listSources } from "./sources";
import { listMeets, type MeetView } from "./swim/load";
import type { EntryView } from "./tennis/entries";
import { tennisOverview, type TennisNextMatch } from "./tennis/overview";

// The iPhone app's Today screen and widgets (intent 0004, APP-2, EXT-1): one
// call with today's events, the week's clashes, school, the next match and
// meet, and what's waiting on the owner.

export type TodayView = {
  // The home time zone's date today.
  date: string;
  homeTimeZone: string;
  // Today's events, for every person; the app filters by its people chips.
  events: EventView[];
  people: Person[];
  // School closure days (CAL-7) from today to 7 days ahead.
  closures: string[];
  // Clashes from now to 7 days ahead, with both events (open and accepted).
  clashes: (ClashView & { eventA: EventView; eventB: EventView })[];
  cursor: number;
  // The primary person's school day, then every child's (his first).
  schoolDay: SchoolDay | null;
  schoolDays: SchoolDay[];
  nextMatches: TennisNextMatch[];
  nextMeet: MeetView | null;
  waiting: {
    // Tournaments found for him that still need entering or paying (TEN-9).
    entries: EntryView[];
    // Email suggestions to approve or reject (EML-3).
    suggestions: number;
    // Sources whose last run failed (SYNC-4).
    failingSources: { id: string; name: string; consecutiveFailures: number }[];
  };
};

const midnight = (date: string, tz: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return zonedToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, tz);
};

// loadCalendar pads its range by a day either side (for clashes at the
// edges), so both lists are trimmed to the asked range here.
const overlaps = (e: EventView, from: Date, to: Date) => new Date(e.start) < to && new Date(e.end) > from;

function clashesWithEvents(cal: CalendarPayload, from: Date, to: Date): TodayView["clashes"] {
  const byId = new Map(cal.events.map((e) => [e.id, e]));
  return cal.clashes
    .flatMap((c) => {
      const eventA = byId.get(c.a);
      const eventB = byId.get(c.b);
      return eventA && eventB ? [{ ...c, eventA, eventB }] : [];
    })
    .filter((c) => overlaps(c.eventA, from, to) || overlaps(c.eventB, from, to))
    .sort((x, y) => x.eventA.start.localeCompare(y.eventA.start));
}

export async function loadToday(db: Db, now = new Date()): Promise<TodayView> {
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
  const week = await loadCalendar(db, now, weekEnd);
  const tz = week.homeTimeZone;
  const date = localDate(now, tz);
  const dayStart = midnight(date, tz);
  const dayEnd = midnight(addDays(date, 1), tz);
  const [day, schoolDays, tennis, meets, suggestions, sources] = await Promise.all([
    loadCalendar(db, dayStart, dayEnd),
    loadSchoolDays(db, now),
    tennisOverview(db),
    listMeets(db),
    pendingCount(db),
    listSources(db),
  ]);
  return {
    date,
    homeTimeZone: tz,
    events: day.events.filter((e) => !e.deletedAt && overlaps(e, dayStart, dayEnd)),
    people: week.people,
    closures: [...new Set([...day.closures, ...week.closures])]
      .filter((d) => d >= date && d <= addDays(date, 7))
      .sort(),
    clashes: clashesWithEvents(week, now, weekEnd),
    cursor: week.cursor,
    schoolDay: schoolDays.find((d) => week.people.some((p) => p.isPrimary && p.id === d.person.id)) ?? null,
    schoolDays,
    nextMatches: tennis.nextMatches,
    nextMeet: meets.upcoming[0] ?? null,
    waiting: {
      entries: tennis.found.filter((e) => e.status === "found" || e.status === "payment_needed"),
      suggestions,
      failingSources: sources
        .filter((s) => s.enabled && s.lastRun?.status === "failed")
        .map((s) => ({ id: s.id, name: s.name, consecutiveFailures: s.consecutiveFailures })),
    },
  };
}
