import { z } from "zod";
import { addDays, localDate } from "@/domain/time";
import { loadCalendar } from "../../calendar/load";
import { loadSchoolDays } from "../../calendar/school-day";
import { midnight } from "./calendar";
import { clock, dayOf, findPerson, namesOf, problem, type Tool } from "./types";

const input = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
    .optional()
    .describe(
      "A day's timetable, YYYY-MM-DD. Leave out for today (or the next school day) and the key dates.",
    ),
  person: z.string().optional().describe("One child (a name from People)"),
});

const KEY_DATE_DAYS = 60;
const MAX_KEY_DATES = 25;

// TOOL-5: school timetables and key dates.
export const schoolTool: Tool<z.infer<typeof input>> = {
  name: "school",
  kind: "hub",
  label: "School",
  description: `School: each child's periods (times, rooms, teachers) for today or the next school day, or for one date; and school closures and key dates in the next ${KEY_DATE_DAYS} days.`,
  input,
  async run(ctx, q) {
    const person = q.person ? findPerson(q.person, ctx.people) : null;
    if (q.person && !person)
      return problem(`no one called ${q.person}; people are ${ctx.people.map((p) => p.name).join(", ")}`);

    if (q.date) {
      const from = midnight(q.date, ctx.timeZone);
      const to = midnight(addDays(q.date, 1), ctx.timeZone);
      const cal = await loadCalendar(ctx.db, from, to);
      const inDay = cal.events.filter(
        (e) => !e.deletedAt && new Date(e.start) < to && new Date(e.end) > from,
      );
      const mine = inDay.filter((e) => !person || e.owners.includes(person.id));
      return {
        date: dayOf(q.date),
        closed: mine.filter((e) => e.category === "school_closure").map((e) => e.title),
        periods: mine
          .filter((e) => e.category === "school_class" && e.status === "active")
          .map((e) => ({
            person: namesOf(e.owners, ctx.people).join(", "),
            start: clock(e.start, ctx.timeZone),
            end: clock(e.end, ctx.timeZone),
            title: e.title,
            room: e.locationName,
            teachers: e.notes?.replace(/^With /, ""),
          })),
      };
    }

    const today = localDate(ctx.now, ctx.timeZone);
    const [days, cal] = await Promise.all([
      loadSchoolDays(ctx.db, ctx.now),
      loadCalendar(ctx.db, ctx.now, midnight(addDays(today, KEY_DATE_DAYS), ctx.timeZone)),
    ]);
    const keyDates = cal.events
      .filter((e) => !e.deletedAt && e.status === "active" && new Date(e.end) > ctx.now)
      .filter((e) => e.category === "school_closure" || e.source?.kind === "school_dates")
      .filter((e) => !person || e.owners.includes(person.id));
    return {
      schoolDays: days
        .filter((d) => !person || d.person.id === person.id)
        .map((d) => ({
          person: d.person.name,
          date: dayOf(d.date),
          isToday: d.today,
          periods: d.periods.map((p) => ({
            start: clock(p.start, ctx.timeZone),
            end: clock(p.end, ctx.timeZone),
            title: p.title,
            room: p.room,
            teachers: p.teachers,
          })),
        })),
      keyDates: keyDates.slice(0, MAX_KEY_DATES).map((e) => ({
        day: dayOf(localDate(new Date(e.start), ctx.timeZone)),
        title: e.title,
        closed: e.category === "school_closure" || undefined,
        people: namesOf(e.owners, ctx.people),
      })),
      more: keyDates.length > MAX_KEY_DATES || undefined,
    };
  },
};
