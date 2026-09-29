import { createHash } from "node:crypto";
import type { Attendance, Category } from "./constants";

// The sync upsert rules (plan M1.4, spec §5.1 step 3, SYNC-3, CAL-6, CON-5),
// as a pure function: given what's stored for one source and what the
// source says now, decide what to insert, update and cancel. It never
// deletes, and it never touches overrides; it only flags them when the
// source changed an event the owner moved.

// One event as a source describes it, after the adapter normalised it.
export type SourceRecord = {
  externalId: string;
  category: Category;
  title: string;
  notes: string | null;
  locationName: string | null;
  startUtc: Date;
  endUtc: Date;
  allDay: boolean;
  attendance: Attendance;
  sourceUrl: string | null;
  // Whose event (`people.id`s), from the source's mapping; none means the
  // primary person.
  ownerIds?: string[];
};

// The span of time the source was asked about. Only stored events that
// start inside it can be cancelled for being missing; older events that a
// feed stops listing stay as history.
export type SyncWindow = { from: Date | null; to: Date | null };

export type StoredEvent = {
  id: string;
  externalId: string;
  status: "active" | "cancelled";
  sourceHash: string | null;
  startUtc: Date;
  hasOverride: boolean;
  fields: SourceRecord;
};

export type PlanItem =
  | { op: "insert"; record: SourceRecord; hash: string }
  | {
      op: "update";
      id: string;
      before: SourceRecord;
      record: SourceRecord;
      hash: string;
      // Was cancelled, and the source lists it again.
      restore: boolean;
      // The owner has an override; keep it and mark "source changed".
      flagOverride: boolean;
    }
  | { op: "cancel"; id: string; before: SourceRecord };

export type SyncPlan = {
  items: PlanItem[];
  unchanged: string[]; // external IDs seen and identical
  counts: { added: number; changed: number; cancelled: number };
  duplicates: string[];
};

export function recordHash(r: SourceRecord): string {
  const stable = [
    r.category,
    r.title,
    r.notes ?? "",
    r.locationName ?? "",
    r.startUtc.toISOString(),
    r.endUtc.toISOString(),
    r.allDay ? "1" : "0",
    r.attendance,
    r.sourceUrl ?? "",
    // Only when set, so events from before owners keep their hash.
    ...(r.ownerIds?.length ? [[...r.ownerIds].sort().join(",")] : []),
  ];
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 32);
}

function inWindow(start: Date, w: SyncWindow): boolean {
  return (!w.from || start >= w.from) && (!w.to || start < w.to);
}

export function planSync(stored: StoredEvent[], incoming: SourceRecord[], window: SyncWindow): SyncPlan {
  // A source listing the same ID twice: the last one wins.
  const byId = new Map<string, SourceRecord>();
  const duplicates: string[] = [];
  for (const r of incoming) {
    if (byId.has(r.externalId)) duplicates.push(r.externalId);
    byId.set(r.externalId, r);
  }
  const storedById = new Map(stored.map((s) => [s.externalId, s]));

  const items: PlanItem[] = [];
  const unchanged: string[] = [];
  const counts = { added: 0, changed: 0, cancelled: 0 };

  for (const [externalId, record] of byId) {
    const hash = recordHash(record);
    const existing = storedById.get(externalId);
    if (!existing) {
      items.push({ op: "insert", record, hash });
      counts.added++;
    } else if (existing.sourceHash !== hash || existing.status === "cancelled") {
      const changedFields = existing.sourceHash !== hash;
      items.push({
        op: "update",
        id: existing.id,
        before: existing.fields,
        record,
        hash,
        restore: existing.status === "cancelled",
        flagOverride: existing.hasOverride && changedFields,
      });
      counts.changed++;
    } else {
      unchanged.push(externalId);
    }
  }

  for (const existing of stored) {
    if (
      existing.status === "active" &&
      !byId.has(existing.externalId) &&
      inWindow(existing.startUtc, window)
    ) {
      items.push({ op: "cancel", id: existing.id, before: existing.fields });
      counts.cancelled++;
    }
  }

  return { items, unchanged, counts, duplicates };
}
