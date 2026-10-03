import { z } from "zod";
import { assistantActions } from "@db/schema";
import {
  asksToAdd,
  CHANGE_LIMITS,
  dayInWords,
  dayProblem,
  eventTimes,
  titleWithNames,
  whoIsIt,
} from "@/domain/assistant-changes";
import { categorise } from "@/domain/categories";
import { localDate } from "@/domain/time";
import { loadCalendar } from "../../calendar/load";
import { createEvent } from "../../calendar/mutations";
import { addTarget, changesSince, cookieActor } from "../actions";
import { clock, problem, type Tool } from "./types";

// The one thing Cookie may add (intent 0008, ADD-1..8): an event a parent
// describes. The checks are the server's, not the prompt's: a problem
// comes back as words for her to ask the parent with, and nothing changes.

const addInput = z.object({
  title: z
    .string()
    .min(1)
    .describe('What it is, without the person\'s name or the time: "dentist appointment"'),
  date: z.string().describe("The day, YYYY-MM-DD"),
  weekday: z
    .string()
    .optional()
    .describe('The weekday exactly as it was said ("Monday", "周四"); leave out if none was said'),
  start: z.string().optional().describe("Start time, HH:MM in 24-hour time; leave out for all day"),
  end: z.string().optional().describe("End time, HH:MM, only if one was said"),
  allDay: z.boolean().optional().describe("True only if the parent said it is all day"),
  people: z
    .array(z.string())
    .describe('Whose it is: names from People, or "everyone". Empty if none was said'),
  location: z.string().optional().describe("The place, only if one was said"),
});

export const calendarAddTool: Tool<z.infer<typeof addInput>> = {
  name: "calendar_add",
  kind: "hub",
  label: "Calendar",
  description:
    "Add ONE event to the family calendar, only when the question itself asks you to add, book or schedule something. Give what was said and nothing you guessed. If it answers with something to ask, ask the parent that and add nothing.",
  input: addInput,
  async run(ctx, q) {
    // ADD-2, CASEC-1: the question's own words, never a tool result's.
    if (!asksToAdd(ctx.question)) return problem("the question didn't ask you to add anything");
    if (ctx.turn.webRan) return problem("nothing can be added in a question that used the web");
    if (ctx.turn.did) return problem("one event per question; this question already added one");
    const dayAgo = new Date(ctx.now.getTime() - 86_400_000);
    if ((await changesSince(ctx.db, dayAgo)) >= CHANGE_LIMITS.perDay)
      return problem("that's enough changes for one day; say the calendar screen can add it");
    const target = await addTarget(ctx.db, ctx.settings);
    // GCW-8
    if (!target)
      return problem(
        "events can't be added until the family's Google Calendar is connected on the Accounts page; say so",
      );

    const who = whoIsIt(q.people, ctx.people);
    if ("problem" in who) return problem(who.problem);
    const day = dayProblem(q.date, q.weekday, localDate(ctx.now, ctx.timeZone));
    if (day) return problem(day);
    const times = eventTimes(q, ctx.timeZone);
    if ("problem" in times) return problem(times.problem);

    // The title and category as the household sync will see them, so
    // nothing shifts when it does. The owners are the people named.
    const title = titleWithNames(q.title, who);
    const ownerIds = who.ids;
    const { category, attendance } = categorise(title, target.mapping);
    const eventId = await createEvent(ctx.db, await cookieActor(ctx.db, ctx.userId), {
      title,
      category,
      attendance,
      ownerIds,
      start: times.start,
      end: times.end,
      allDay: times.allDay,
      notes: null,
      locationName: q.location?.trim() || null,
    });
    const [action] = await ctx.db
      .insert(assistantActions)
      .values({
        userId: ctx.userId,
        kind: "add_event",
        eventId,
        sourceId: target.sourceId,
        createdAt: ctx.now,
      })
      .returning({ id: assistantActions.id });
    ctx.turn.actionIds.push(action.id);
    // GCW-4: the worker writes it to Google; the daily sync catches up if
    // this start is lost.
    await ctx.launch?.(["assistant:actions"]).catch(() => undefined);
    const startsAt = times.allDay ? null : clock(times.start, ctx.timeZone);
    ctx.turn.did = { title, date: q.date, start: startsAt, names: who.names, everyone: who.everyone };

    // ADD-7: a clash with another event of the same people.
    const clashes = times.allDay ? [] : await overlapping(ctx, eventId, times, ownerIds);
    return {
      adding: {
        title,
        day: dayInWords(q.date),
        time: startsAt ?? "all day",
        for: who.everyone ? "everyone" : who.names,
        place: q.location?.trim() || undefined,
      },
      clashesWith: clashes.length ? clashes : undefined,
      say: 'Say "Adding:" and read this back in one line, with the weekday and whose it is; name a clash if there is one. It reaches the family calendar in about a minute.',
    };
  },
};

async function overlapping(
  ctx: Parameters<typeof calendarAddTool.run>[0],
  eventId: string,
  times: { start: Date; end: Date },
  ownerIds: string[],
) {
  const cal = await loadCalendar(ctx.db, times.start, times.end);
  return cal.events
    .filter((e) => e.id !== eventId && !e.deletedAt && !e.allDay && e.status === "active")
    .filter((e) => new Date(e.start) < times.end && new Date(e.end) > times.start)
    .filter((e) => e.owners.some((id) => ownerIds.includes(id)))
    .slice(0, 3)
    .map((e) => ({ title: e.title, at: clock(new Date(e.start), ctx.timeZone) }));
}

export const CHANGE_TOOLS = [calendarAddTool] as Tool[];
