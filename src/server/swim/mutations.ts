import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { changeLog, swimMeets, swimResults } from "@db/schema";
import { parseSwimTime } from "../../domain/swim";
import { COURSES, DISTANCES, STROKES, type Course } from "../../domain/swim-constants";
import { disagrees, type SwimResultValues } from "../../domain/swim-upsert";
import type { Db, DbOrTx } from "../db/client";
import { HttpError } from "../errors";
import { revision, rowValues } from "./apply";

// The owner's own results and corrections (SWM-7, SYNC-6). A corrected
// result keeps the owner's values through every later sync; sync only
// records the source's version and flags a disagreement (see apply.ts).

const time = z
  .string()
  .trim()
  .transform((s, ctx) => {
    const ms = parseSwimTime(s);
    if (ms === null) {
      ctx.addIssue({ code: "custom", message: "Write the time like 1:08.23 or 34.85." });
      return z.NEVER;
    }
    return ms;
  });
const date = z.iso.date({ message: "Give the date of the swim." });
const optionalInt = z.number().int().min(0).max(500).nullable().optional();

export const addResultInput = z
  .object({
    swimDate: date,
    distance: z
      .number()
      .int()
      .refine((d) => (DISTANCES as readonly number[]).includes(d), "Pick a distance."),
    stroke: z.enum(STROKES),
    course: z.enum(COURSES),
    // Empty with dq set: a DQ with no time.
    time: z.union([time, z.literal("").transform(() => null)]),
    dqReason: z.string().trim().max(120).optional(),
    place: optionalInt,
    notes: z.string().trim().max(500).optional(),
    // An existing meet, a new one, or neither.
    meetId: z.uuid().optional(),
    newMeet: z.lazy(() => createMeetInput).optional(),
  })
  .refine((v) => v.time !== null || !!v.dqReason, "Give a time, or a reason for the DQ.")
  .refine((v) => !(v.meetId && v.newMeet), "Pick a meet or add a new one, not both.");

export const correctResultInput = z
  .object({
    time: z.union([time, z.literal("").transform(() => null)]).optional(),
    dqReason: z.string().trim().max(120).nullable().optional(),
    place: optionalInt,
    swimDate: date.optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change.");

async function noteChange(db: DbOrTx, id: string) {
  await db.insert(changeLog).values({ kind: "swim", refId: id });
}

export const createMeetInput = z.object({
  name: z.string().trim().min(1, "Give the meet a name.").max(120),
  course: z.enum(COURSES),
  startDate: date,
  endDate: date.optional(),
  city: z.string().trim().max(80).optional(),
});

export async function createMeet(
  db: DbOrTx,
  m: { name: string; course: Course; startDate: string; endDate?: string; city?: string },
) {
  if (m.endDate && m.endDate < m.startDate) throw new HttpError(400, "The meet can't end before it starts.");
  const [row] = await db
    .insert(swimMeets)
    .values({
      name: m.name,
      course: m.course,
      startDate: m.startDate,
      endDate: m.endDate ?? m.startDate,
      city: m.city || null,
      signup: "yes",
    })
    .returning({ id: swimMeets.id });
  return row.id;
}

export async function addResult(db: Db, actor: string, input: z.infer<typeof addResultInput>) {
  return db.transaction(async (tx) => {
    let meetId: string | null = null;
    if (input.meetId) {
      const [meet] = await tx.select().from(swimMeets).where(eq(swimMeets.id, input.meetId));
      if (!meet) throw new HttpError(400, "That meet wasn't found.");
      if (meet.course && meet.course !== input.course)
        throw new HttpError(400, `That meet is ${meet.course}; pick the matching course.`);
      meetId = meet.id;
    } else if (input.newMeet) {
      meetId = await createMeet(tx, input.newMeet);
    }
    const values = {
      meetId,
      swimDate: input.swimDate,
      distance: input.distance,
      stroke: input.stroke,
      course: input.course,
      timeMs: input.dqReason ? null : input.time,
      dqReason: input.dqReason || null,
      place: input.place ?? null,
      notes: input.notes || null,
    };
    const [row] = await tx
      .insert(swimResults)
      .values({ ...values, origin: "manual", correctedBy: actor })
      .returning({ id: swimResults.id });
    await revision(tx, row.id, "manual_add", actor, null, values);
    await noteChange(tx, row.id);
    return row.id;
  });
}

async function loadRow(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(swimResults)
    .where(and(eq(swimResults.id, id), isNull(swimResults.deletedAt)));
  if (!row) throw new HttpError(404, "not found");
  return row;
}

export async function correctResult(
  db: Db,
  actor: string,
  id: string,
  input: z.infer<typeof correctResultInput>,
) {
  const row = await loadRow(db, id);
  const next = { ...row };
  if (input.time !== undefined) next.timeMs = input.time;
  if (input.dqReason !== undefined) next.dqReason = input.dqReason || null;
  if (next.dqReason) next.timeMs = null;
  if (next.timeMs === null && !next.dqReason)
    throw new HttpError(400, "Give a time, or a reason for the DQ.");
  if (input.place !== undefined) next.place = input.place;
  if (input.swimDate !== undefined) next.swimDate = input.swimDate;
  if (input.notes !== undefined) next.notes = input.notes || null;
  // Splits that no longer add up to the corrected time are dropped.
  if (next.timeMs !== row.timeMs) next.splits = [];
  const before = rowValues(row, null);
  const after = rowValues(next, null);
  const source = row.sourceValues as SwimResultValues | null;
  const values = {
    timeMs: next.timeMs,
    dqReason: next.dqReason,
    place: next.place,
    swimDate: next.swimDate,
    notes: next.notes,
    splits: next.splits,
  };
  await db.transaction(async (tx) => {
    await tx
      .update(swimResults)
      .set({
        ...values,
        correctedAt: sql`now()`,
        correctedBy: actor,
        // Only a swim a source knows about can disagree with it.
        sourceDisagrees: row.externalId !== null ? (source ? disagrees(after, source) : true) : false,
        updatedAt: sql`now()`,
      })
      .where(eq(swimResults.id, id));
    await revision(tx, id, "correct", actor, before, after);
    await noteChange(tx, id);
  });
}

// Drop the owner's correction and show the source's values again.
export async function useSourceValues(db: Db, actor: string, id: string) {
  const row = await loadRow(db, id);
  const source = row.sourceValues as SwimResultValues | null;
  if (!source) throw new HttpError(409, "The source has no version of this swim.");
  const [meet] = source.meetExternalId
    ? await db
        .select({ id: swimMeets.id })
        .from(swimMeets)
        .where(and(eq(swimMeets.sourceId, row.sourceId!), eq(swimMeets.externalId, source.meetExternalId)))
    : [];
  await db.transaction(async (tx) => {
    await tx
      .update(swimResults)
      .set({
        meetId: meet?.id ?? row.meetId,
        swimDate: source.swimDate,
        timeMs: source.timeMs,
        place: source.place,
        heat: source.heat,
        lane: source.lane,
        stage: source.stage,
        dqReason: source.dqReason,
        splits: source.splits,
        origin: "source",
        correctedAt: null,
        correctedBy: null,
        sourceDisagrees: false,
        updatedAt: sql`now()`,
      })
      .where(eq(swimResults.id, id));
    await revision(tx, id, "use_source", actor, rowValues(row, null), source);
    await noteChange(tx, id);
  });
}

export async function deleteResult(db: Db, actor: string, id: string) {
  const row = await loadRow(db, id);
  await db.transaction(async (tx) => {
    await tx
      .update(swimResults)
      .set({ deletedAt: sql`now()` })
      .where(eq(swimResults.id, id));
    await revision(tx, id, "delete", actor, rowValues(row, null), null);
    await noteChange(tx, id);
  });
}

export async function restoreResult(db: Db, actor: string, id: string) {
  const [row] = await db.select().from(swimResults).where(eq(swimResults.id, id));
  if (!row) throw new HttpError(404, "not found");
  await db.transaction(async (tx) => {
    await tx.update(swimResults).set({ deletedAt: null }).where(eq(swimResults.id, id));
    await revision(tx, id, "restore", actor, null, rowValues(row, null));
    await noteChange(tx, id);
  });
}
