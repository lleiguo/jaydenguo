import { and, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { changeLog, conflicts, eventOverrides, eventRevisions, events, eventSeries } from "@db/schema";
import { pairKey } from "../../domain/clashes";
import { ATTENDANCE, CATEGORIES, type Attendance } from "../../domain/constants";
import { resolveOwners } from "../../domain/people";
import { expandSeries } from "../../domain/series";
import { isValidTimeZone, localDate } from "../../domain/time";
import type { Undo } from "../../lib/calendar-types";
import type { Db, Tx } from "../db/client";
import { HttpError } from "../errors";
import { listPeople } from "../people";
import { getHomeTimeZone } from "../settings";
import { syncRecords } from "../sync/apply";

// Changes the owner makes on the calendar (CAL-5, CAL-6, CON-3, CON-4).
// Every change writes a revision and a change-log entry (CAL-8), and
// nothing is hard-deleted. Moving or skipping an event from a source only
// writes an override, so the source is never touched (CON-6).

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const when = z.coerce.date();

export const eventInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.enum(CATEGORIES),
    attendance: z.enum(ATTENDANCE).default("required"),
    // Whose event (`people.id`s); none means the primary person.
    ownerIds: z.array(z.uuid()).max(20).optional(),
    start: when,
    end: when,
    allDay: z.boolean().default(false),
    notes: z.string().max(2000).nullable().default(null),
    locationName: z.string().max(300).nullable().default(null),
  })
  .refine((v) => v.end >= v.start, "the end must be after the start");

export const seriesInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.enum(CATEGORIES),
    attendance: z.enum(ATTENDANCE).default("required"),
    ownerIds: z.array(z.uuid()).max(20).optional(),
    notes: z.string().max(2000).nullable().default(null),
    locationName: z.string().max(300).nullable().default(null),
    allDay: z.boolean().default(false),
    startDate: isoDate,
    untilDate: isoDate.nullable().default(null),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    durationMin: z.number().int().min(1).max(10_080),
    intervalWeeks: z.number().int().min(1).max(52).default(1),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    timeZone: z.string().refine(isValidTimeZone).optional(),
  })
  .refine((v) => !v.untilDate || v.untilDate >= v.startDate, "the end date must be after the start date");

export const moveInput = z.object({ start: when, end: when }).refine((v) => v.end >= v.start, "bad times");

type Actor = string;

const note = (tx: Tx, kind: string, refId: string | null) => tx.insert(changeLog).values({ kind, refId });
const revise = (tx: Tx, eventId: string, actor: Actor, action: string, before: unknown, after: unknown) =>
  tx
    .insert(eventRevisions)
    .values({ eventId, changedBy: actor, action, before: before ?? null, after: after ?? null });

async function getEvent(tx: Tx, id: string) {
  const [e] = await tx.select().from(events).where(eq(events.id, id));
  if (!e) throw new HttpError(404, "event not found");
  return e;
}

const fieldsOf = (e: typeof events.$inferSelect) => ({
  title: e.title,
  category: e.category,
  attendance: e.attendance,
  ownerIds: e.ownerIds,
  start: e.startUtc.toISOString(),
  end: e.endUtc.toISOString(),
  allDay: e.allDay,
  notes: e.notes,
  locationName: e.locationName,
});

const isSingleManual = (e: typeof events.$inferSelect) => !e.sourceId && !e.seriesId;

// `origin` is for events added from another place, e.g. an approved email
// suggestion (EML-3): its source and a link back.
export async function createEvent(
  db: Db,
  actor: Actor,
  input: z.infer<typeof eventInput>,
  origin?: { sourceId: string; externalId: string; sourceUrl: string | null },
) {
  return db.transaction(async (tx) => {
    const [e] = await tx
      .insert(events)
      .values({
        ...origin,
        title: input.title,
        category: input.category,
        attendance: input.attendance,
        ownerIds: input.ownerIds ?? [],
        startUtc: input.start,
        endUtc: input.end,
        allDay: input.allDay,
        notes: input.notes,
        locationName: input.locationName,
      })
      .returning();
    await revise(tx, e.id, actor, "insert", null, fieldsOf(e));
    await note(tx, "event", e.id);
    return e.id;
  });
}

export async function updateEvent(db: Db, actor: Actor, id: string, input: z.infer<typeof eventInput>) {
  return db.transaction(async (tx) => {
    const before = await getEvent(tx, id);
    if (!isSingleManual(before)) throw new HttpError(409, "only events added here can be edited");
    const [after] = await tx
      .update(events)
      .set({
        title: input.title,
        category: input.category,
        attendance: input.attendance,
        ownerIds: input.ownerIds ?? before.ownerIds,
        startUtc: input.start,
        endUtc: input.end,
        allDay: input.allDay,
        notes: input.notes,
        locationName: input.locationName,
        updatedAt: new Date(),
      })
      .where(eq(events.id, id))
      .returning();
    await revise(tx, id, actor, "update", fieldsOf(before), fieldsOf(after));
    await note(tx, "event", id);
  });
}

// CAL-6: a manual delete sets deleted_at; the event can be restored.
export async function deleteEvent(db: Db, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const e = await getEvent(tx, id);
    if (e.sourceId) throw new HttpError(409, "events from a source can be skipped, not deleted");
    await tx.update(events).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(events.id, id));
    await revise(tx, id, actor, "delete", fieldsOf(e), null);
    await note(tx, "event", id);
  });
}

export async function restoreEvent(db: Db, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const e = await getEvent(tx, id);
    await tx.update(events).set({ deletedAt: null, updatedAt: new Date() }).where(eq(events.id, id));
    await revise(tx, id, actor, "restore", null, fieldsOf(e));
    await note(tx, "event", id);
  });
}

async function activeOverride(tx: Tx, eventId: string) {
  const [o] = await tx
    .select()
    .from(eventOverrides)
    .where(and(eq(eventOverrides.eventId, eventId), isNull(eventOverrides.clearedAt)));
  return o ?? null;
}

// Replaces the event's override with a new one, keeping a link to the old
// one so undo can bring it back.
async function writeOverride(
  tx: Tx,
  actor: Actor,
  e: typeof events.$inferSelect,
  change: {
    newStartUtc?: Date | null;
    newEndUtc?: Date | null;
    skip?: boolean;
    attendance?: Attendance | null;
    ownerIds?: string[] | null;
  },
): Promise<string> {
  const previous = await activeOverride(tx, e.id);
  if (previous) {
    await tx
      .update(eventOverrides)
      .set({ clearedAt: new Date(), clearedBy: actor })
      .where(eq(eventOverrides.id, previous.id));
  }
  const [o] = await tx
    .insert(eventOverrides)
    .values({
      eventId: e.id,
      newStartUtc: change.newStartUtc !== undefined ? change.newStartUtc : (previous?.newStartUtc ?? null),
      newEndUtc: change.newEndUtc !== undefined ? change.newEndUtc : (previous?.newEndUtc ?? null),
      skip: change.skip ?? previous?.skip ?? false,
      attendance: change.attendance !== undefined ? change.attendance : (previous?.attendance ?? null),
      ownerIds: change.ownerIds !== undefined ? change.ownerIds : (previous?.ownerIds ?? null),
      createdBy: actor,
      // What the source said when the owner changed it (CON-5).
      sourceSnapshot: { start: e.startUtc.toISOString(), end: e.endUtc.toISOString(), title: e.title },
      replacesId: previous?.id ?? null,
    })
    .returning();
  await revise(tx, e.id, actor, change.skip ? "skip" : "override", previous, o);
  await note(tx, "override", e.id);
  return o.id;
}

// CON-3: drag and drop or "Move to…". Events added here move directly;
// events from a source or a series get an override that survives syncs.
export async function moveEvent(
  db: Db,
  actor: Actor,
  id: string,
  input: z.infer<typeof moveInput>,
): Promise<Undo> {
  return db.transaction(async (tx) => {
    const e = await getEvent(tx, id);
    if (isSingleManual(e)) {
      await tx
        .update(events)
        .set({ startUtc: input.start, endUtc: input.end, updatedAt: new Date() })
        .where(eq(events.id, id));
      await revise(tx, id, actor, "move", fieldsOf(e), { start: input.start, end: input.end });
      await note(tx, "event", id);
      return {
        method: "POST",
        url: `/api/v1/events/${id}/move`,
        body: { start: e.startUtc.toISOString(), end: e.endUtc.toISOString() },
      };
    }
    const moved =
      input.start.getTime() !== e.startUtc.getTime() || input.end.getTime() !== e.endUtc.getTime();
    const overrideId = await writeOverride(tx, actor, e, {
      newStartUtc: moved ? input.start : null,
      newEndUtc: moved ? input.end : null,
    });
    return { method: "POST", url: `/api/v1/overrides/${overrideId}/undo` };
  });
}

// CON-4 "skip this one": Jayden won't attend.
export async function skipEvent(db: Db, actor: Actor, id: string, skip: boolean): Promise<Undo> {
  return db.transaction(async (tx) => {
    const e = await getEvent(tx, id);
    const overrideId = await writeOverride(tx, actor, e, { skip });
    return { method: "POST", url: `/api/v1/overrides/${overrideId}/undo` };
  });
}

// Required or optional (CON-1): an optional event never clashes. Events
// added here change directly; events from a source or a series get an
// override that survives syncs.
export const attendanceInput = z.object({ attendance: z.enum(ATTENDANCE) });

export async function setAttendance(db: Db, actor: Actor, id: string, attendance: Attendance): Promise<Undo> {
  return db.transaction(async (tx) => {
    const e = await getEvent(tx, id);
    if (isSingleManual(e)) {
      await tx.update(events).set({ attendance, updatedAt: new Date() }).where(eq(events.id, id));
      await revise(tx, id, actor, "attendance", { attendance: e.attendance }, { attendance });
      await note(tx, "event", id);
      return { method: "POST", url: `/api/v1/events/${id}/attendance`, body: { attendance: e.attendance } };
    }
    // Back to what the source says: no attendance override.
    const overrideId = await writeOverride(tx, actor, e, {
      attendance: attendance === e.attendance ? null : attendance,
    });
    return { method: "POST", url: `/api/v1/overrides/${overrideId}/undo` };
  });
}

// Whose event it is (owner, 2026-09-28): e.g. a parent's dentist from the
// family calendar is Lei's, so it only clashes with Lei's day. Saved like
// attendance: directly, or on an override that survives syncs.
export const ownersInput = z.object({ ownerIds: z.array(z.uuid()).min(1).max(20) });

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

export async function setOwners(db: Db, actor: Actor, id: string, ownerIds: string[]): Promise<Undo> {
  return db.transaction(async (tx) => {
    const e = await getEvent(tx, id);
    if (isSingleManual(e)) {
      await tx.update(events).set({ ownerIds, updatedAt: new Date() }).where(eq(events.id, id));
      await revise(tx, id, actor, "owners", { ownerIds: e.ownerIds }, { ownerIds });
      await note(tx, "event", id);
      return { method: "POST", url: `/api/v1/events/${id}/owners`, body: { ownerIds: e.ownerIds } };
    }
    // Back to what the source says: no owners override.
    const people = await listPeople(tx);
    const same = sameSet(resolveOwners(ownerIds, people), resolveOwners(e.ownerIds, people));
    const overrideId = await writeOverride(tx, actor, e, { ownerIds: same ? null : ownerIds });
    return { method: "POST", url: `/api/v1/overrides/${overrideId}/undo` };
  });
}

// Undo: clear this override and bring back the one it replaced.
export async function undoOverride(db: Db, actor: Actor, overrideId: string) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(eventOverrides).where(eq(eventOverrides.id, overrideId));
    if (!o || o.clearedAt) throw new HttpError(409, "nothing to undo");
    await tx
      .update(eventOverrides)
      .set({ clearedAt: new Date(), clearedBy: actor })
      .where(eq(eventOverrides.id, o.id));
    if (o.replacesId) {
      await tx
        .update(eventOverrides)
        .set({ clearedAt: null, clearedBy: null })
        .where(eq(eventOverrides.id, o.replacesId));
    }
    await revise(tx, o.eventId, actor, "override_undone", o, null);
    await note(tx, "override", o.eventId);
  });
}

// "Use the source's time": drop the override altogether.
export async function resetEvent(db: Db, actor: Actor, eventId: string) {
  return db.transaction(async (tx) => {
    const o = await activeOverride(tx, eventId);
    if (!o) return;
    // Only the time goes back; "skip", attendance and whose event it is stay.
    if (o.skip || o.attendance || o.ownerIds) {
      await writeOverride(tx, actor, await getEvent(tx, eventId), { newStartUtc: null, newEndUtc: null });
      return;
    }
    await tx
      .update(eventOverrides)
      .set({ clearedAt: new Date(), clearedBy: actor })
      .where(eq(eventOverrides.id, o.id));
    await revise(tx, eventId, actor, "override_cleared", o, null);
    await note(tx, "override", eventId);
  });
}

// CON-4 "accept clash", per pair of events.
export async function acceptClash(db: Db, actor: Actor, x: string, y: string): Promise<Undo> {
  const [a, b] = pairKey(x, y);
  return db.transaction(async (tx) => {
    await getEvent(tx, a);
    await getEvent(tx, b);
    const [existing] = await tx
      .select()
      .from(conflicts)
      .where(and(eq(conflicts.eventA, a), eq(conflicts.eventB, b), isNull(conflicts.undoneAt)));
    const id =
      existing?.id ??
      (await tx.insert(conflicts).values({ eventA: a, eventB: b, resolvedBy: actor }).returning())[0].id;
    await revise(tx, a, actor, "accept_clash", null, { with: b });
    await revise(tx, b, actor, "accept_clash", null, { with: a });
    await note(tx, "conflict", id);
    return { method: "POST", url: `/api/v1/clashes/${id}/undo` };
  });
}

export async function undoAcceptClash(db: Db, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .update(conflicts)
      .set({ undoneAt: new Date() })
      .where(eq(conflicts.id, id))
      .returning();
    if (!c) throw new HttpError(404, "not found");
    await revise(tx, c.eventA, actor, "accept_clash_undone", { with: c.eventB }, null);
    await note(tx, "conflict", id);
  });
}

// CAL-5 repeating events: the series is stored once and its occurrences are
// written through the sync upsert engine, so edits become revisions and
// dropped occurrences are cancelled rather than deleted.
async function writeOccurrences(db: Db, actor: Actor, seriesId: string, fromDate: string) {
  const [s] = await db.select().from(eventSeries).where(eq(eventSeries.id, seriesId));
  const today = localDate(new Date(), s.timeZone);
  const records = expandSeries(
    {
      ...s,
      category: s.category as never,
      attendance: s.attendance as never,
    },
    today,
  ).filter((r) => r.externalId >= fromDate);
  await syncRecords(
    db,
    { seriesId },
    records,
    { from: new Date(`${fromDate}T00:00:00Z`), to: null },
    { actor },
  );
}

export async function createSeries(db: Db, actor: Actor, input: z.infer<typeof seriesInput>) {
  const timeZone = input.timeZone ?? (await getHomeTimeZone(db));
  const [s] = await db
    .insert(eventSeries)
    .values({ ...input, timeZone })
    .returning({ id: eventSeries.id });
  await writeOccurrences(db, actor, s.id, input.startDate);
  return s.id;
}

// Edits apply from today on; past occurrences stay as they were.
export async function updateSeries(db: Db, actor: Actor, id: string, input: z.infer<typeof seriesInput>) {
  const [s] = await db.select().from(eventSeries).where(eq(eventSeries.id, id));
  if (!s || s.deletedAt) throw new HttpError(404, "not found");
  await db
    .update(eventSeries)
    .set({ ...input, timeZone: input.timeZone ?? s.timeZone, updatedAt: new Date() })
    .where(eq(eventSeries.id, id));
  const today = localDate(new Date(), s.timeZone);
  await writeOccurrences(db, actor, id, input.startDate > today ? input.startDate : today);
}

export async function deleteSeries(db: Db, actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const [s] = await tx
      .update(eventSeries)
      .set({ deletedAt: new Date() })
      .where(eq(eventSeries.id, id))
      .returning();
    if (!s) throw new HttpError(404, "not found");
    // Future occurrences are deleted (restorable); past ones stay.
    const future = await tx
      .update(events)
      .set({ deletedAt: new Date() })
      .where(and(eq(events.seriesId, id), gte(events.startUtc, new Date()), isNull(events.deletedAt)))
      .returning({ id: events.id });
    for (const e of future) await revise(tx, e.id, actor, "delete", null, null);
    await tx.insert(changeLog).values({ kind: "series", refId: id });
  });
}

export async function getSeries(db: Db, id: string) {
  const [s] = await db.select().from(eventSeries).where(eq(eventSeries.id, id));
  if (!s) throw new HttpError(404, "not found");
  return s;
}

// Keeps open-ended series written out two years ahead (daily job).
export async function extendAllSeries(db: Db) {
  const all = await db
    .select({ id: eventSeries.id, timeZone: eventSeries.timeZone })
    .from(eventSeries)
    .where(isNull(eventSeries.deletedAt));
  for (const s of all) await writeOccurrences(db, "series", s.id, localDate(new Date(), s.timeZone));
  return all.length;
}
