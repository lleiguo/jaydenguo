import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { changeLog, eventOverrides, eventRevisions, events } from "@db/schema";
import {
  planSync,
  type SourceRecord,
  type StoredEvent,
  type SyncPlan,
  type SyncWindow,
} from "../../domain/upsert";
import type { Db, DbOrTx } from "../db/client";

// Writes a sync plan to Postgres in one transaction: rows, a revision for
// every change, the "source changed" flag on overrides, and one change-log
// entry so open browsers refresh (spec §5.1 steps 3 and 5).

export type SyncScope = { sourceId: string } | { seriesId: string };

const scopeFilter = (scope: SyncScope) =>
  "sourceId" in scope ? eq(events.sourceId, scope.sourceId) : eq(events.seriesId, scope.seriesId);

function sourceFields(r: SourceRecord) {
  return {
    category: r.category,
    title: r.title,
    notes: r.notes,
    locationName: r.locationName,
    startUtc: r.startUtc,
    endUtc: r.endUtc,
    allDay: r.allDay,
    attendance: r.attendance,
    sourceUrl: r.sourceUrl,
  };
}

async function loadStored(db: DbOrTx, scope: SyncScope): Promise<StoredEvent[]> {
  const rows = await db
    .select({ event: events, overrideId: eventOverrides.id })
    .from(events)
    .leftJoin(eventOverrides, and(eq(eventOverrides.eventId, events.id), isNull(eventOverrides.clearedAt)))
    .where(scopeFilter(scope));
  return rows.map(({ event: e, overrideId }) => ({
    id: e.id,
    externalId: e.externalId!,
    status: e.status as StoredEvent["status"],
    sourceHash: e.sourceHash,
    startUtc: e.startUtc,
    hasOverride: overrideId !== null,
    fields: {
      externalId: e.externalId!,
      category: e.category as SourceRecord["category"],
      title: e.title,
      notes: e.notes,
      locationName: e.locationName,
      startUtc: e.startUtc,
      endUtc: e.endUtc,
      allDay: e.allDay,
      attendance: e.attendance as SourceRecord["attendance"],
      sourceUrl: e.sourceUrl,
    },
  }));
}

export type ApplyOptions = { actor: string; syncRunId?: string };

export async function syncRecords(
  db: Db,
  scope: SyncScope,
  incoming: SourceRecord[],
  window: SyncWindow,
  opts: ApplyOptions,
): Promise<SyncPlan> {
  return db.transaction(async (tx) => {
    // Serialise syncs of the same scope inside Postgres too.
    const key = "sourceId" in scope ? `source:${scope.sourceId}` : `series:${scope.seriesId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);

    const plan = planSync(await loadStored(tx, scope), incoming, window);
    const now = new Date();
    const revision = (eventId: string, action: string, before: unknown, after: unknown) =>
      tx.insert(eventRevisions).values({
        eventId,
        action,
        changedBy: opts.actor,
        syncRunId: opts.syncRunId,
        before: before ?? null,
        after: after ?? null,
      });

    for (const item of plan.items) {
      if (item.op === "insert") {
        const [row] = await tx
          .insert(events)
          .values({
            ...("sourceId" in scope ? { sourceId: scope.sourceId } : { seriesId: scope.seriesId }),
            externalId: item.record.externalId,
            ...sourceFields(item.record),
            status: "active",
            sourceHash: item.hash,
            lastSyncedAt: now,
          })
          .returning({ id: events.id });
        await revision(row.id, "insert", null, sourceFields(item.record));
      } else if (item.op === "update") {
        await tx
          .update(events)
          .set({
            ...sourceFields(item.record),
            status: "active",
            sourceHash: item.hash,
            lastSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(events.id, item.id));
        await revision(
          item.id,
          item.restore ? "restore" : "update",
          sourceFields(item.before),
          sourceFields(item.record),
        );
        if (item.flagOverride) {
          await tx
            .update(eventOverrides)
            .set({ sourceChangedAt: now })
            .where(and(eq(eventOverrides.eventId, item.id), isNull(eventOverrides.clearedAt)));
        }
      } else {
        await tx.update(events).set({ status: "cancelled", updatedAt: now }).where(eq(events.id, item.id));
        await revision(item.id, "cancel", sourceFields(item.before), null);
      }
    }

    if (plan.unchanged.length) {
      await tx
        .update(events)
        .set({ lastSyncedAt: now })
        .where(and(scopeFilter(scope), inArray(events.externalId, plan.unchanged)));
    }
    if (plan.items.length) {
      await tx.insert(changeLog).values({
        kind: "sync",
        refId: "sourceId" in scope ? scope.sourceId : scope.seriesId,
      });
    }
    return plan;
  });
}
