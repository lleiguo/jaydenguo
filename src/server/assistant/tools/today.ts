import { z } from "zod";
import { loadToday } from "../../today";
import { openClashIds, shapeDraw, shapeEvent, shapeMeet } from "./shape";
import { clock, dayOf, namesOf, stamp, type Tool } from "./types";

// TOOL-1: the Today view, which answers most "what's on" questions in one call.
export const todayTool: Tool<Record<string, never>> = {
  name: "today",
  kind: "hub",
  label: "Today",
  description:
    "Today at a glance: today's events for everyone, what's next, clashes in the next 7 days, each child's school day, the next tennis match and swim meet, and what is waiting on a parent. Use this first for questions about today.",
  input: z.object({}),
  async run(ctx) {
    const t = await loadToday(ctx.db, ctx.now);
    const clashing = openClashIds(t.clashes);
    const live = t.events.filter((e) => e.status === "active" && !e.override?.skip);
    const next = live.find((e) => !e.allDay && new Date(e.end) > ctx.now);
    return {
      date: dayOf(t.date),
      now: clock(ctx.now, ctx.timeZone),
      next: next ? shapeEvent(next, ctx, clashing) : undefined,
      events: t.events.map((e) => shapeEvent(e, ctx, clashing)),
      clashesNext7Days: t.clashes.map((c) => ({
        a: c.eventA.title,
        b: c.eventB.title,
        when: stamp(c.eventA.start, ctx.timeZone),
        overlapMinutes: c.overlapMin,
        people: namesOf(c.people, ctx.people),
        accepted: !!c.acceptedId || undefined,
      })),
      schoolClosedOn: t.closures.map(dayOf),
      school: t.schoolDays.map((d) => ({
        person: d.person.name,
        date: dayOf(d.date),
        isToday: d.today,
        periods: d.periods.map((p) => ({
          start: clock(p.start, ctx.timeZone),
          end: clock(p.end, ctx.timeZone),
          title: p.title,
          room: p.room,
        })),
      })),
      nextTennisMatches: t.nextMatches.map((n) => ({
        tournament: n.tournament.name,
        ...shapeDraw(n.draw, n.prediction),
      })),
      nextSwimMeet: t.nextMeet ? shapeMeet(t.nextMeet) : undefined,
      waiting: {
        tennisEntries: t.waiting.entries.map((e) => ({
          tournament: e.tournamentName,
          event: e.eventName,
          status: e.status,
          deadline: e.entryDeadline,
        })),
        emailSuggestions: t.waiting.suggestions || undefined,
        failingSources: t.waiting.failingSources.map((s) => s.name),
      },
    };
  },
};
