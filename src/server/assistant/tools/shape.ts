import type { ClashView, EventView } from "@/lib/calendar-types";
import { eventLabel, formatSwimTime } from "@/domain/swim";
import { localDate } from "@/domain/time";
import type { MeetView } from "../../swim/load";
import type { DrawView, PredictionView } from "../../tennis/load";
import { clock, dayOf, namesOf, stamp, type ToolContext } from "./types";

// How hub data is put to the model: only what an answer could use, in the
// home time zone, with estimates labelled as estimates (CHR-5).

export function shapeEvent(e: EventView, ctx: ToolContext, clashing?: Set<string>) {
  const sameDay = localDate(new Date(e.start), ctx.timeZone) === localDate(new Date(e.end), ctx.timeZone);
  return {
    title: e.title,
    ...(e.allDay
      ? { day: dayOf(localDate(new Date(e.start), ctx.timeZone)), allDay: true }
      : {
          start: stamp(e.start, ctx.timeZone),
          end: sameDay ? clock(e.end, ctx.timeZone) : stamp(e.end, ctx.timeZone),
        }),
    place: e.locationName,
    people: namesOf(e.owners, ctx.people),
    category: e.category,
    notes: e.notes?.slice(0, 200),
    optional: e.attendance === "optional" || undefined,
    cancelled: e.status === "cancelled" || undefined,
    skipped: e.override?.skip || undefined,
    moved: e.override?.moved || undefined,
    clash: clashing?.has(e.id) || undefined,
    schoolClosedThatDay: e.schoolClosed || undefined,
  };
}

// Events in a clash the owner hasn't accepted.
export const openClashIds = (clashes: ClashView[]) =>
  new Set(clashes.filter((c) => !c.acceptedId).flatMap((c) => [c.a, c.b]));

export function shapePrediction(p: PredictionView | null) {
  if (!p) return undefined;
  return {
    winPercentEstimate: Math.round(p.probability * 100),
    confidence: p.confidence,
    why: p.why,
    headToHead: p.headToHead,
  };
}

export function shapeDraw(d: DrawView, prediction: PredictionView | null = null) {
  const n = d.next;
  return {
    event: d.eventName,
    draw: d.drawName,
    seed: d.seed,
    withdrawn: d.status === "withdrawn" || undefined,
    next:
      n?.status === "next"
        ? {
            round: n.round,
            opponent: n.opponent?.name ?? (n.feeders ? `winner of ${n.feeders[0]} v ${n.feeders[1]}` : null),
            date: n.date,
            time: n.time,
          }
        : n
          ? { status: n.status }
          : undefined,
    prediction: shapePrediction(prediction),
  };
}

export function shapeMeet(m: MeetView) {
  return {
    name: m.name,
    start: dayOf(m.startDate),
    end: m.endDate === m.startDate ? undefined : dayOf(m.endDate),
    venue: m.venue,
    city: m.city,
    course: m.course,
    signedUp: m.signup,
    sessions: m.sessions.map((s) => `${dayOf(s.date)} ${s.time}`),
    entries: m.entries.map((e) => ({
      event: eventLabel(e),
      seed: e.seedTimeMs ? formatSwimTime(e.seedTimeMs) : undefined,
    })),
    swims: m.swims || undefined,
    pbs: m.pbs || undefined,
  };
}
