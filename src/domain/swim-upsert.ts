import { createHash } from "node:crypto";
import type { SyncWindow } from "./upsert";
import type { Course, Stroke } from "./swim-constants";

// Sync rules for swim meets, entries and results (plan M2.3, M2.7; SYNC-3,
// SWM-7 with TEN-8's rule), as pure functions like src/domain/upsert.ts.
// Nothing is deleted. A result the owner corrected or added by hand is never
// overwritten: sync only records the source's version next to it and flags
// the row when the two disagree.

export type SwimSplit = { distance: number; ms: number };

export type SwimEntryRecord = {
  distance: number;
  stroke: Stroke;
  course: Course;
  seedTimeMs: number | null;
  meetDay: number | null;
  sessionStart: string | null; // "HH:MM", meet local time
};

export type SwimMeetRecord = {
  externalId: string;
  name: string;
  course: Course | null;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  venue: string | null;
  city: string | null;
  signup: "yes" | "no" | null;
  sourceUrl: string | null;
  // null: the source doesn't list entries for this meet (keep what's stored).
  entries: SwimEntryRecord[] | null;
};

export type SwimResultValues = {
  meetExternalId: string | null;
  swimDate: string;
  distance: number;
  stroke: Stroke;
  course: Course;
  timeMs: number | null;
  place: number | null;
  heat: number | null;
  lane: number | null;
  stage: string | null;
  dqReason: string | null;
  splits: SwimSplit[];
};

export type SwimResultRecord = SwimResultValues & { externalId: string };

export type SwimBatch = { meets: SwimMeetRecord[]; results: SwimResultRecord[]; window: SyncWindow };

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

// A meet's own fields, without its entries.
export function meetFields(m: SwimMeetRecord) {
  return {
    externalId: m.externalId,
    name: m.name,
    course: m.course,
    startDate: m.startDate,
    endDate: m.endDate,
    venue: m.venue,
    city: m.city,
    signup: m.signup,
    sourceUrl: m.sourceUrl,
  };
}

export function meetHash(m: SwimMeetRecord): string {
  return hash(meetFields(m));
}

export function resultValues(r: SwimResultRecord): SwimResultValues {
  return {
    meetExternalId: r.meetExternalId,
    swimDate: r.swimDate,
    distance: r.distance,
    stroke: r.stroke,
    course: r.course,
    timeMs: r.timeMs,
    place: r.place,
    heat: r.heat,
    lane: r.lane,
    stage: r.stage,
    dqReason: r.dqReason,
    splits: r.splits,
  };
}

export function resultHash(r: SwimResultValues): string {
  return hash([
    r.meetExternalId,
    r.swimDate,
    r.distance,
    r.stroke,
    r.course,
    r.timeMs,
    r.place,
    r.heat,
    r.lane,
    r.stage,
    r.dqReason,
    r.splits.map((s) => [s.distance, s.ms]),
  ]);
}

// --- Meets ---------------------------------------------------------------

export type StoredMeet = {
  id: string;
  externalId: string;
  status: "active" | "cancelled";
  sourceHash: string | null;
  startDate: string;
};

export type MeetPlanItem =
  | { op: "insert"; record: SwimMeetRecord; hash: string }
  | { op: "update"; id: string; record: SwimMeetRecord; hash: string }
  | { op: "cancel"; id: string };

export function planMeets(
  stored: StoredMeet[],
  incoming: SwimMeetRecord[],
  window: SyncWindow,
): MeetPlanItem[] {
  const byId = new Map(incoming.map((m) => [m.externalId, m]));
  const storedById = new Map(stored.map((s) => [s.externalId, s]));
  const items: MeetPlanItem[] = [];
  for (const [externalId, record] of byId) {
    const h = meetHash(record);
    const existing = storedById.get(externalId);
    if (!existing) items.push({ op: "insert", record, hash: h });
    else if (existing.sourceHash !== h || existing.status === "cancelled")
      items.push({ op: "update", id: existing.id, record, hash: h });
  }
  // A meet that vanished from the source is cancelled, but only recent and
  // future ones (like events, M1.4), and never on an empty fetch.
  if (incoming.length) {
    const from = window.from?.toISOString().slice(0, 10);
    for (const s of stored) {
      if (s.status === "active" && !byId.has(s.externalId) && (!from || s.startDate >= from))
        items.push({ op: "cancel", id: s.id });
    }
  }
  return items;
}

// --- Results -------------------------------------------------------------

export type StoredResult = {
  id: string;
  externalId: string | null;
  origin: "source" | "manual";
  status: "active" | "cancelled";
  deleted: boolean;
  corrected: boolean;
  sourceHash: string | null;
  sourceDisagrees: boolean;
  // What the row shows now.
  values: SwimResultValues;
};

// Fields sync may fill on an owner-entered row when the row has none.
export type ResultFill = Partial<
  Pick<SwimResultValues, "meetExternalId" | "place" | "heat" | "lane" | "stage">
>;

export type ResultPlanItem =
  | { op: "insert"; record: SwimResultRecord; hash: string }
  // Not corrected: the row takes the source's values.
  | {
      op: "update";
      id: string;
      before: SwimResultValues;
      record: SwimResultRecord;
      hash: string;
      restore: boolean;
    }
  // Corrected or owner-entered: keep the row, record the source's version.
  | {
      op: "source";
      id: string;
      record: SwimResultRecord | null;
      hash: string | null;
      disagrees: boolean;
      fill: ResultFill;
      // First time this owner-entered row meets its source result.
      link: boolean;
    }
  | { op: "cancel"; id: string; before: SwimResultValues };

export type ResultPlan = {
  items: ResultPlanItem[];
  unchanged: string[];
  counts: { added: number; changed: number; cancelled: number };
};

// The owner's row and the source disagree when the swim's outcome differs:
// the time or the DQ. Extra detail the owner didn't enter (place, splits)
// isn't a disagreement.
export function disagrees(row: SwimResultValues, source: SwimResultValues): boolean {
  return row.timeMs !== source.timeMs || !!row.dqReason !== !!source.dqReason;
}

function fillFor(row: SwimResultValues, source: SwimResultValues): ResultFill {
  const fill: ResultFill = {};
  if (row.meetExternalId === null && source.meetExternalId !== null)
    fill.meetExternalId = source.meetExternalId;
  for (const k of ["place", "heat", "lane", "stage"] as const) {
    if (row[k] === null && source[k] !== null) (fill as Record<string, unknown>)[k] = source[k];
  }
  return fill;
}

const sameSwim = (a: SwimResultValues, b: SwimResultValues) =>
  a.swimDate === b.swimDate && a.distance === b.distance && a.stroke === b.stroke && a.course === b.course;

export function planResults(stored: StoredResult[], incoming: SwimResultRecord[]): ResultPlan {
  const byId = new Map<string, SwimResultRecord>();
  for (const r of incoming) byId.set(r.externalId, r);
  const storedById = new Map(stored.filter((s) => s.externalId).map((s) => [s.externalId!, s]));
  // Owner-entered rows not yet tied to a source result.
  const unlinked = stored.filter(
    (s) => s.origin === "manual" && !s.externalId && !s.deleted && s.status === "active",
  );

  const items: ResultPlanItem[] = [];
  const unchanged: string[] = [];
  const counts = { added: 0, changed: 0, cancelled: 0 };

  for (const [externalId, record] of byId) {
    const h = resultHash(record);
    const existing = storedById.get(externalId);
    if (!existing) {
      // The owner may have typed this swim in before the source had it.
      const candidates = unlinked.filter((m) => sameSwim(m.values, record));
      if (candidates.length) {
        const closest = candidates.sort(
          (a, b) =>
            Math.abs((a.values.timeMs ?? 0) - (record.timeMs ?? 0)) -
            Math.abs((b.values.timeMs ?? 0) - (record.timeMs ?? 0)),
        )[0];
        unlinked.splice(unlinked.indexOf(closest), 1);
        items.push({
          op: "source",
          id: closest.id,
          record,
          hash: h,
          disagrees: disagrees(closest.values, record),
          fill: fillFor(closest.values, record),
          link: true,
        });
        counts.changed++;
      } else {
        items.push({ op: "insert", record, hash: h });
        counts.added++;
      }
      continue;
    }
    if (existing.corrected || existing.origin === "manual") {
      const disagree = disagrees(existing.values, record);
      const fill = fillFor(existing.values, record);
      if (existing.sourceHash !== h || existing.sourceDisagrees !== disagree || Object.keys(fill).length) {
        items.push({
          op: "source",
          id: existing.id,
          record,
          hash: h,
          disagrees: disagree,
          fill,
          link: false,
        });
        counts.changed++;
      } else unchanged.push(externalId);
      continue;
    }
    if (existing.sourceHash !== h || existing.status === "cancelled") {
      items.push({
        op: "update",
        id: existing.id,
        before: existing.values,
        record,
        hash: h,
        restore: existing.status === "cancelled",
      });
      counts.changed++;
    } else unchanged.push(externalId);
  }

  // Results the source stopped listing. An empty fetch cancels nothing: a
  // site hiccup must never wipe a swimmer's history (NFR-6).
  if (byId.size) {
    for (const s of stored) {
      if (!s.externalId || byId.has(s.externalId) || s.status !== "active") continue;
      if (s.corrected || s.origin === "manual") {
        // Keep the owner's version; say the source no longer has it.
        if (s.sourceHash !== null || !s.sourceDisagrees)
          items.push({
            op: "source",
            id: s.id,
            record: null,
            hash: null,
            disagrees: true,
            fill: {},
            link: false,
          });
        continue;
      }
      items.push({ op: "cancel", id: s.id, before: s.values });
      counts.cancelled++;
    }
  }
  return { items, unchanged, counts };
}
