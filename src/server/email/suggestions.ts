import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { emailMessages, emailSuggestions, events, sources } from "@db/schema";
import { CATEGORIES } from "../../domain/constants";
import { looksAlike } from "../../domain/duplicates";
import { localDate, zonedToUtc } from "../../domain/time";
import { loadCalendar } from "../calendar/load";
import { createEvent, moveEvent, skipEvent } from "../calendar/mutations";
import type { Undo } from "../../lib/calendar-types";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { getHomeTimeZone } from "../settings";

// The approve-or-reject queue (EML-2, EML-3, plan M5.8). Approving a new
// event adds it with its email source and a link to the message; a change
// moves the event it's about, and a cancellation skips it, both as the
// owner's own changes (overrides), so the source is never touched.

export type Extracted = {
  title: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  category: string;
  notes: string | null;
};
export type Confidence = Record<
  "overall" | "title" | "date" | "time" | "location",
  "high" | "medium" | "low"
>;

type EventRef = { id: string; title: string; start: string; end: string; allDay: boolean };

export type SuggestionView = {
  id: string;
  sourceId: string;
  kind: "new" | "change" | "cancel";
  // pending, approved, rejected, or expired: still pending in the table
  // but about a day that's over (0011 TID-1).
  status: string;
  extracted: Extracted;
  confidence: Confidence;
  quote: string;
  messageUrl: string;
  from: string;
  subject: string;
  receivedAt: string;
  sourceName: string;
  target: EventRef | null;
  // A new event that seems to be on the calendar already (0013 DUP-3).
  similar: EventRef | null;
  eventId: string | null;
  decidedAt: string | null;
};

// The day a suggestion is about (0011 TID-1): its own date, else the
// home-zone day of the event it changes or cancels.
export function suggestionDay(
  extracted: Pick<Extracted, "date">,
  target: { startUtc: Date; allDay: boolean } | null,
  tz: string,
): string | null {
  if (extracted.date) return extracted.date;
  if (!target) return null;
  // All-day events are stored as UTC midnights of their dates.
  return target.allDay ? target.startUtc.toISOString().slice(0, 10) : localDate(target.startUtc, tz);
}

// Over once its day is before today; with no day, it waits.
export function isPastSuggestion(day: string | null, today: string): boolean {
  return day !== null && day < today;
}

export async function listSuggestions(
  db: Db,
  status: "pending" | "decided" = "pending",
  now = new Date(),
): Promise<SuggestionView[]> {
  const tz = await getHomeTimeZone(db);
  const today = localDate(now, tz);
  const rows = await db
    .select({ s: emailSuggestions, m: emailMessages, sourceName: sources.name, t: events })
    .from(emailSuggestions)
    .innerJoin(emailMessages, eq(emailMessages.id, emailSuggestions.messageId))
    .innerJoin(sources, eq(sources.id, emailSuggestions.sourceId))
    .leftJoin(events, eq(events.id, emailSuggestions.targetEventId))
    .where(status === "pending" ? eq(emailSuggestions.status, "pending") : undefined)
    .orderBy(desc(emailMessages.receivedAt), emailSuggestions.createdAt)
    .limit(status === "pending" ? 200 : 50);
  const views = rows
    .map(({ s, m, sourceName, t }): SuggestionView => ({
      id: s.id,
      sourceId: s.sourceId,
      kind: s.kind as SuggestionView["kind"],
      // TID-1, TID-2: a pending one about a past day is cleared.
      status:
        s.status === "pending" && isPastSuggestion(suggestionDay(s.extracted as Extracted, t, tz), today)
          ? "expired"
          : s.status,
      extracted: s.extracted as Extracted,
      confidence: s.confidence as Confidence,
      quote: s.quote,
      messageUrl: s.messageUrl,
      from: m.fromAddress,
      subject: m.subject,
      receivedAt: m.receivedAt.toISOString(),
      sourceName,
      target: t
        ? {
            id: t.id,
            title: t.title,
            start: t.startUtc.toISOString(),
            end: t.endUtc.toISOString(),
            allDay: t.allDay,
          }
        : null,
      similar: null,
      eventId: s.eventId,
      decidedAt: s.decidedAt?.toISOString() ?? null,
    }))
    .filter((v) => (status === "pending") === (v.status === "pending"));
  return status === "pending" ? withSimilar(db, views, tz) : views;
}

// DUP-3: for each waiting new event, the first event already on the
// calendar for the same activity at the same time, if any.
async function withSimilar(db: Db, views: SuggestionView[], tz: string): Promise<SuggestionView[]> {
  const slots = new Map(
    views
      .filter((v) => v.kind === "new" && v.extracted.date)
      .map((v) => [
        v.id,
        { ...times({ ...v.extracted, date: v.extracted.date! }, tz), category: v.extracted.category },
      ]),
  );
  if (!slots.size) return views;
  const all = [...slots.values()];
  const from = new Date(Math.min(...all.map((t) => t.start.getTime())));
  const to = new Date(Math.max(...all.map((t) => t.end.getTime())));
  const existing = (await loadCalendar(db, from, to)).events
    .filter((e) => e.status === "active" && !e.override?.skip)
    .map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
  return views.map((v) => {
    const slot = slots.get(v.id);
    const e = slot && existing.find((x) => looksAlike(slot, x));
    return e
      ? {
          ...v,
          similar: {
            id: e.id,
            title: e.title,
            start: e.start.toISOString(),
            end: e.end.toISOString(),
            allDay: e.allDay,
          },
        }
      : v;
  });
}

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times are HH:MM")
  .nullable();

// The owner can correct the fields before approving.
export const approveInput = z.object({
  title: z.string().trim().min(1).max(200),
  date: z.iso.date("Enter the date"),
  startTime: time,
  endTime: time,
  location: z.string().trim().max(300).nullable(),
  category: z.enum(CATEGORIES),
});

function times(input: Pick<z.infer<typeof approveInput>, "date" | "startTime" | "endTime">, tz: string) {
  const [y, mo, d] = input.date.split("-").map(Number);
  if (!input.startTime) {
    const start = new Date(`${input.date}T00:00:00Z`);
    return { start, end: new Date(start.getTime() + 86_400_000), allDay: true };
  }
  const at = (hhmm: string) => {
    const [hour, minute] = hhmm.split(":").map(Number);
    return zonedToUtc({ year: y, month: mo, day: d, hour, minute, second: 0 }, tz);
  };
  const start = at(input.startTime);
  let end = input.endTime ? at(input.endTime) : new Date(start.getTime() + 60 * 60_000);
  if (end <= start) end = new Date(start.getTime() + 60 * 60_000);
  return { start, end, allDay: false };
}

async function pending(db: Db, id: string) {
  const [s] = await db.select().from(emailSuggestions).where(eq(emailSuggestions.id, id));
  if (!s) throw new HttpError(404, "not found");
  if (s.status !== "pending") throw new HttpError(409, "This suggestion was already decided.");
  const [t] = s.targetEventId ? await db.select().from(events).where(eq(events.id, s.targetEventId)) : [];
  const tz = await getHomeTimeZone(db);
  // TID-2
  if (isPastSuggestion(suggestionDay(s.extracted as Extracted, t ?? null, tz), localDate(new Date(), tz)))
    throw new HttpError(409, "This is already over.");
  return s;
}

export async function approveSuggestion(
  db: Db,
  actor: string,
  id: string,
  input: z.infer<typeof approveInput> | null,
): Promise<{ eventId: string | null; undo: Undo | null }> {
  const s = await pending(db, id);
  const ex = s.extracted as Extracted;
  let eventId: string | null = null;
  // How to take back a change or a cancellation (Cookie's Undo, 0008 ACT-3).
  let undo: Undo | null = null;
  if (s.kind === "cancel") {
    if (!s.targetEventId) throw new HttpError(409, "The event this cancels is gone.");
    undo = await skipEvent(db, actor, s.targetEventId, true);
  } else {
    const fields = input ?? {
      title: ex.title,
      date: ex.date ?? "",
      startTime: ex.startTime,
      endTime: ex.endTime,
      location: ex.location,
      category: ex.category as (typeof CATEGORIES)[number],
    };
    const parsed = approveInput.parse(fields);
    const t = times(parsed, await getHomeTimeZone(db));
    if (s.kind === "change") {
      if (!s.targetEventId) throw new HttpError(409, "The event this changes is gone.");
      undo = await moveEvent(db, actor, s.targetEventId, { start: t.start, end: t.end });
    } else {
      eventId = await createEvent(
        db,
        actor,
        {
          title: parsed.title,
          category: parsed.category,
          attendance: "required",
          start: t.start,
          end: t.end,
          allDay: t.allDay,
          notes: ex.notes,
          locationName: parsed.location,
        },
        // EML-3: source "email", with a link back to the message.
        { sourceId: s.sourceId, externalId: `email:${s.id}`, sourceUrl: s.messageUrl },
      );
    }
  }
  const [done] = await db
    .update(emailSuggestions)
    .set({ status: "approved", eventId, decidedAt: new Date() })
    .where(and(eq(emailSuggestions.id, id), eq(emailSuggestions.status, "pending")))
    .returning({ id: emailSuggestions.id });
  if (!done) throw new HttpError(409, "This suggestion was already decided.");
  return { eventId, undo };
}

// Cookie's Undo (intent 0008, ACT-3): an applied suggestion goes back to
// waiting on the Suggestions page. Its event is dealt with by the caller.
export async function unapproveSuggestion(db: Db, id: string) {
  await db
    .update(emailSuggestions)
    .set({ status: "pending", eventId: null, decidedAt: null })
    .where(and(eq(emailSuggestions.id, id), eq(emailSuggestions.status, "approved")));
}

export async function rejectSuggestion(db: Db, id: string) {
  await pending(db, id);
  await db
    .update(emailSuggestions)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(and(eq(emailSuggestions.id, id), eq(emailSuggestions.status, "pending")));
}

// Waiting ones, leaving out those already over (TID-1).
export async function pendingCount(db: Db): Promise<number> {
  return (await listSuggestions(db, "pending")).length;
}
