import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { emailMessages, emailSuggestions, events, sources } from "@db/schema";
import { CATEGORIES } from "../../domain/constants";
import { zonedToUtc } from "../../domain/time";
import { createEvent, moveEvent, skipEvent } from "../calendar/mutations";
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

export type SuggestionView = {
  id: string;
  sourceId: string;
  kind: "new" | "change" | "cancel";
  status: string;
  extracted: Extracted;
  confidence: Confidence;
  quote: string;
  messageUrl: string;
  from: string;
  subject: string;
  receivedAt: string;
  sourceName: string;
  target: { id: string; title: string; start: string; end: string; allDay: boolean } | null;
  eventId: string | null;
  decidedAt: string | null;
};

export async function listSuggestions(
  db: Db,
  status: "pending" | "decided" = "pending",
): Promise<SuggestionView[]> {
  const rows = await db
    .select({ s: emailSuggestions, m: emailMessages, sourceName: sources.name, t: events })
    .from(emailSuggestions)
    .innerJoin(emailMessages, eq(emailMessages.id, emailSuggestions.messageId))
    .innerJoin(sources, eq(sources.id, emailSuggestions.sourceId))
    .leftJoin(events, eq(events.id, emailSuggestions.targetEventId))
    .where(status === "pending" ? eq(emailSuggestions.status, "pending") : undefined)
    .orderBy(desc(emailMessages.receivedAt), emailSuggestions.createdAt)
    .limit(status === "pending" ? 200 : 50);
  return rows
    .filter((r) => status === "pending" || r.s.status !== "pending")
    .map(({ s, m, sourceName, t }) => ({
      id: s.id,
      sourceId: s.sourceId,
      kind: s.kind as SuggestionView["kind"],
      status: s.status,
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
      eventId: s.eventId,
      decidedAt: s.decidedAt?.toISOString() ?? null,
    }));
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

function times(input: z.infer<typeof approveInput>, tz: string) {
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
  return s;
}

export async function approveSuggestion(
  db: Db,
  actor: string,
  id: string,
  input: z.infer<typeof approveInput> | null,
): Promise<{ eventId: string | null }> {
  const s = await pending(db, id);
  const ex = s.extracted as Extracted;
  let eventId: string | null = null;
  if (s.kind === "cancel") {
    if (!s.targetEventId) throw new HttpError(409, "The event this cancels is gone.");
    await skipEvent(db, actor, s.targetEventId, true);
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
      await moveEvent(db, actor, s.targetEventId, { start: t.start, end: t.end });
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
  return { eventId };
}

export async function rejectSuggestion(db: Db, id: string) {
  await pending(db, id);
  await db
    .update(emailSuggestions)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(and(eq(emailSuggestions.id, id), eq(emailSuggestions.status, "pending")));
}

export async function pendingCount(db: Db): Promise<number> {
  const rows = await db
    .select({ id: emailSuggestions.id })
    .from(emailSuggestions)
    .where(eq(emailSuggestions.status, "pending"));
  return rows.length;
}
