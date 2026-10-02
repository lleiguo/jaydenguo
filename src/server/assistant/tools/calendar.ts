import { z } from "zod";
import { CATEGORIES } from "@/domain/constants";
import { addDays, zonedToUtc } from "@/domain/time";
import { loadCalendar } from "../../calendar/load";
import { openClashIds, shapeEvent } from "./shape";
import { findPerson, has, problem, type Tool } from "./types";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

const input = z.object({
  from: day.describe("First day, YYYY-MM-DD"),
  to: day.describe("Last day, YYYY-MM-DD (the same as from for one day)"),
  person: z.string().optional().describe("Only this person's events (a name from People)"),
  category: z.enum(CATEGORIES).optional(),
  text: z.string().optional().describe("Only events whose title or place contains this"),
});

export const MAX_DAYS = 31;
export const MAX_EVENTS = 40;

export const midnight = (date: string, tz: string) => {
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  return zonedToUtc({ year, month, day: dayOfMonth, hour: 0, minute: 0, second: 0 }, tz);
};

// TOOL-2: calendar events in a date range.
export const calendarTool: Tool<z.infer<typeof input>> = {
  name: "calendar",
  kind: "hub",
  label: "Calendar",
  description: `Calendar events between two days (at most ${MAX_DAYS} days), for everyone or one person: practices, games, lessons, classes, school closures. Past days work too.`,
  input,
  async run(ctx, q) {
    if (q.to < q.from) return problem("`to` is before `from`");
    if (q.to > addDays(q.from, MAX_DAYS - 1)) return problem(`ask for at most ${MAX_DAYS} days at a time`);
    const person = q.person ? findPerson(q.person, ctx.people) : null;
    if (q.person && !person)
      return problem(`no one called ${q.person}; people are ${ctx.people.map((p) => p.name).join(", ")}`);
    const from = midnight(q.from, ctx.timeZone);
    const to = midnight(addDays(q.to, 1), ctx.timeZone);
    const cal = await loadCalendar(ctx.db, from, to);
    const clashing = openClashIds(cal.clashes);
    const events = cal.events
      .filter((e) => !e.deletedAt && new Date(e.start) < to && new Date(e.end) > from)
      .filter((e) => !person || e.owners.includes(person.id))
      .filter((e) => !q.category || e.category === q.category)
      .filter((e) => !q.text || has(e.title, q.text) || has(e.locationName, q.text));
    return {
      from: q.from,
      to: q.to,
      count: events.length,
      events: events.slice(0, MAX_EVENTS).map((e) => shapeEvent(e, ctx, clashing)),
      more: events.length > MAX_EVENTS || undefined,
    };
  },
};
