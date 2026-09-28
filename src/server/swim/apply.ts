import { and, eq, inArray, sql } from "drizzle-orm";
import { changeLog, swimEntries, swimMeets, swimResultRevisions, swimResults } from "@db/schema";
import type { Course, Stroke } from "../../domain/swim-constants";
import {
  planMeets,
  meetFields,
  planResults,
  resultValues,
  type StoredResult,
  type SwimBatch,
  type SwimResultValues,
  type SwimSplit,
} from "../../domain/swim-upsert";
import type { Db, DbOrTx } from "../db/client";

// Writes a swim sync plan in one transaction (plan M2.3): meets, entries,
// results, a revision for every result change, and a change-log entry.

type ResultRow = typeof swimResults.$inferSelect;

export function rowValues(r: ResultRow, meetExternalId: string | null): SwimResultValues {
  return {
    meetExternalId,
    swimDate: r.swimDate,
    distance: r.distance,
    stroke: r.stroke as Stroke,
    course: r.course as Course,
    timeMs: r.timeMs,
    place: r.place,
    heat: r.heat,
    lane: r.lane,
    stage: r.stage,
    dqReason: r.dqReason,
    splits: (r.splits ?? []) as SwimSplit[],
  };
}

// The row fields a set of values maps to.
function columns(v: SwimResultValues, meetId: string | null) {
  return {
    meetId,
    swimDate: v.swimDate,
    distance: v.distance,
    stroke: v.stroke,
    course: v.course,
    timeMs: v.timeMs,
    place: v.place,
    heat: v.heat,
    lane: v.lane,
    stage: v.stage,
    dqReason: v.dqReason,
    splits: v.splits,
  };
}

export async function revision(
  db: DbOrTx,
  resultId: string,
  action: string,
  changedBy: string,
  before: unknown,
  after: unknown,
  syncRunId?: string,
) {
  await db.insert(swimResultRevisions).values({
    resultId,
    action,
    changedBy,
    syncRunId,
    before: before ?? null,
    after: after ?? null,
  });
}

export type SwimCounts = { added: number; changed: number; cancelled: number };

export async function syncSwim(
  db: Db,
  sourceId: string,
  batch: SwimBatch,
  opts: { actor: string; syncRunId?: string },
): Promise<SwimCounts> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`swim:${sourceId}`}))`);
    const now = new Date();
    const counts: SwimCounts = { added: 0, changed: 0, cancelled: 0 };

    // Meets.
    const storedMeets = await tx.select().from(swimMeets).where(eq(swimMeets.sourceId, sourceId));
    const meetPlan = planMeets(
      storedMeets.map((m) => ({
        id: m.id,
        externalId: m.externalId!,
        status: m.status as "active" | "cancelled",
        sourceHash: m.sourceHash,
        startDate: m.startDate,
      })),
      batch.meets,
      batch.window,
    );
    for (const item of meetPlan) {
      if (item.op === "cancel") {
        await tx
          .update(swimMeets)
          .set({ status: "cancelled", updatedAt: now })
          .where(eq(swimMeets.id, item.id));
        continue;
      }
      const values = {
        ...meetFields(item.record),
        sourceHash: item.hash,
        status: "active",
        lastSyncedAt: now,
      };
      if (item.op === "insert") await tx.insert(swimMeets).values({ sourceId, ...values });
      else
        await tx
          .update(swimMeets)
          .set({ ...values, updatedAt: now })
          .where(eq(swimMeets.id, item.id));
    }
    const meets = await tx
      .select({ id: swimMeets.id, externalId: swimMeets.externalId })
      .from(swimMeets)
      .where(eq(swimMeets.sourceId, sourceId));
    const meetIdByExternal = new Map(meets.map((m) => [m.externalId!, m.id]));
    const externalByMeetId = new Map(meets.map((m) => [m.id, m.externalId!]));

    // Entries, for meets whose entries the source lists.
    for (const meet of batch.meets) {
      if (meet.entries === null) continue;
      const meetId = meetIdByExternal.get(meet.externalId)!;
      const existing = await tx.select().from(swimEntries).where(eq(swimEntries.meetId, meetId));
      const key = (e: { distance: number; stroke: string; course: string }) =>
        `${e.distance}|${e.stroke}|${e.course}`;
      const wanted = new Map(meet.entries.map((e) => [key(e), e]));
      for (const e of existing) {
        const want = wanted.get(key(e));
        if (!want && e.status === "active")
          await tx
            .update(swimEntries)
            .set({ status: "withdrawn", updatedAt: now })
            .where(eq(swimEntries.id, e.id));
        else if (
          want &&
          (e.status !== "active" ||
            e.seedTimeMs !== want.seedTimeMs ||
            e.meetDay !== want.meetDay ||
            e.sessionStart !== want.sessionStart)
        )
          await tx
            .update(swimEntries)
            .set({
              status: "active",
              seedTimeMs: want.seedTimeMs,
              meetDay: want.meetDay,
              sessionStart: want.sessionStart,
              updatedAt: now,
            })
            .where(eq(swimEntries.id, e.id));
        wanted.delete(key(e));
      }
      if (wanted.size)
        await tx.insert(swimEntries).values([...wanted.values()].map((e) => ({ meetId, ...e })));
    }
    counts.added += meetPlan.filter((i) => i.op === "insert").length;

    // Results: this source's, plus owner-entered ones not tied to a source.
    const rows = await tx
      .select()
      .from(swimResults)
      .where(
        sql`${swimResults.sourceId} = ${sourceId} or (${swimResults.sourceId} is null and ${swimResults.origin} = 'manual')`,
      );
    const meetExt = (r: ResultRow) =>
      r.meetId ? (externalByMeetId.get(r.meetId) ?? `manual:${r.meetId}`) : null;
    const stored: StoredResult[] = rows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      origin: r.origin as "source" | "manual",
      status: r.status as "active" | "cancelled",
      deleted: r.deletedAt !== null,
      corrected: r.correctedAt !== null,
      sourceHash: r.sourceHash,
      sourceDisagrees: r.sourceDisagrees,
      values: rowValues(r, meetExt(r)),
    }));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const meetIdFor = (ext: string | null) => (ext ? (meetIdByExternal.get(ext) ?? null) : null);
    const plan = planResults(stored, batch.results);

    for (const item of plan.items) {
      if (item.op === "insert") {
        const values = resultValues(item.record);
        const [row] = await tx
          .insert(swimResults)
          .values({
            sourceId,
            externalId: item.record.externalId,
            ...columns(values, meetIdFor(values.meetExternalId)),
            origin: "source",
            sourceValues: values,
            sourceHash: item.hash,
            lastSyncedAt: now,
          })
          .returning({ id: swimResults.id });
        await revision(tx, row.id, "insert", opts.actor, null, values, opts.syncRunId);
      } else if (item.op === "update") {
        const values = resultValues(item.record);
        await tx
          .update(swimResults)
          .set({
            ...columns(values, meetIdFor(values.meetExternalId)),
            status: "active",
            sourceValues: values,
            sourceHash: item.hash,
            lastSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(swimResults.id, item.id));
        await revision(
          tx,
          item.id,
          item.restore ? "restore" : "update",
          opts.actor,
          item.before,
          values,
          opts.syncRunId,
        );
      } else if (item.op === "source") {
        const row = byId.get(item.id)!;
        const values = item.record ? resultValues(item.record) : null;
        const fill = { ...item.fill } as Record<string, unknown>;
        if ("meetExternalId" in fill) {
          fill.meetId = meetIdFor(fill.meetExternalId as string);
          delete fill.meetExternalId;
        }
        await tx
          .update(swimResults)
          .set({
            ...fill,
            ...(item.link ? { sourceId, externalId: item.record!.externalId } : {}),
            sourceValues: values,
            sourceHash: item.hash,
            sourceDisagrees: item.disagrees,
            lastSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(swimResults.id, item.id));
        if (item.link || item.disagrees !== row.sourceDisagrees) {
          await revision(
            tx,
            item.id,
            item.link ? "link" : item.disagrees ? "source_disagrees" : "source_agrees",
            opts.actor,
            row.sourceValues,
            values,
            opts.syncRunId,
          );
        }
      } else {
        await tx
          .update(swimResults)
          .set({ status: "cancelled", updatedAt: now })
          .where(eq(swimResults.id, item.id));
        await revision(tx, item.id, "cancel", opts.actor, item.before, null, opts.syncRunId);
      }
    }
    if (plan.unchanged.length) {
      await tx
        .update(swimResults)
        .set({ lastSyncedAt: now })
        .where(and(eq(swimResults.sourceId, sourceId), inArray(swimResults.externalId, plan.unchanged)));
    }
    counts.added += plan.counts.added;
    counts.changed += plan.counts.changed + meetPlan.filter((i) => i.op === "update").length;
    counts.cancelled += plan.counts.cancelled + meetPlan.filter((i) => i.op === "cancel").length;
    if (plan.items.length || meetPlan.length) {
      await tx.insert(changeLog).values({ kind: "swim", refId: sourceId });
    }
    return counts;
  });
}
