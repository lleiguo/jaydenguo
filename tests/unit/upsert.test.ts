import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/domain/constants";
import { planSync, recordHash, type SourceRecord, type StoredEvent, type SyncPlan } from "@/domain/upsert";

// A tiny in-memory store that applies plans the way the database applier
// does, so the rules can be property-tested (plan M1.4).
type Row = StoredEvent & { overrideSnapshot: string | null; overrideFlagged: boolean };

function apply(rows: Map<string, Row>, plan: SyncPlan) {
  let n = 0;
  for (const item of plan.items) {
    if (item.op === "insert") {
      const id = `id-${rows.size}-${n++}`;
      rows.set(item.record.externalId, {
        id,
        externalId: item.record.externalId,
        status: "active",
        sourceHash: item.hash,
        startUtc: item.record.startUtc,
        hasOverride: false,
        fields: item.record,
        overrideSnapshot: null,
        overrideFlagged: false,
      });
    } else {
      const row = [...rows.values()].find((r) => r.id === item.id)!;
      if (item.op === "update") {
        Object.assign(row, {
          status: "active",
          sourceHash: item.hash,
          startUtc: item.record.startUtc,
          fields: item.record,
        });
        if (item.flagOverride) row.overrideFlagged = true;
      } else {
        row.status = "cancelled";
      }
    }
  }
}

const base = Date.UTC(2026, 9, 1);
const recordArb = (id: string) =>
  fc
    .record({
      externalId: fc.constant(id),
      category: fc.constantFrom(...CATEGORIES),
      title: fc.constantFrom("Practice", "Game", "Lesson"),
      notes: fc.option(fc.constantFrom("bring water", "away game"), { nil: null }),
      locationName: fc.option(fc.constantFrom("Field 1", "Arena"), { nil: null }),
      startUtc: fc.integer({ min: 0, max: 60 }).map((d) => new Date(base + d * 86_400_000)),
      endUtc: fc.constant(new Date(0)),
      allDay: fc.boolean(),
      attendance: fc.constantFrom("required" as const, "optional" as const, "parent_only" as const),
      sourceUrl: fc.constant(null),
    })
    .map((r) => ({ ...r, endUtc: new Date(r.startUtc.getTime() + 3_600_000) }) as SourceRecord);

// A feed is a subset of a fixed pool of IDs, each with random fields.
const feedArb = fc
  .uniqueArray(fc.constantFrom(...Array.from({ length: 12 }, (_, i) => `uid-${i}`)), { maxLength: 12 })
  .chain((ids) => fc.tuple(...ids.map(recordArb)))
  .map((records) => records as SourceRecord[]);

const window = { from: null, to: null };
const stored = (rows: Map<string, Row>) => [...rows.values()];

describe("planSync", () => {
  it("running the same feed twice changes nothing the second time (SYNC-3)", () => {
    fc.assert(
      fc.property(fc.array(feedArb, { minLength: 1, maxLength: 4 }), (feeds) => {
        const rows = new Map<string, Row>();
        for (const feed of feeds) apply(rows, planSync(stored(rows), feed, window));
        const again = planSync(stored(rows), feeds.at(-1)!, window);
        expect(again.items).toEqual([]);
      }),
    );
  });

  it("never deletes: the number of stored events only grows (CAL-6)", () => {
    fc.assert(
      fc.property(fc.array(feedArb, { minLength: 1, maxLength: 5 }), (feeds) => {
        const rows = new Map<string, Row>();
        let size = 0;
        for (const feed of feeds) {
          const plan = planSync(stored(rows), feed, window);
          expect(plan.items.every((i) => ["insert", "update", "cancel"].includes(i.op))).toBe(true);
          apply(rows, plan);
          expect(rows.size).toBeGreaterThanOrEqual(size);
          size = rows.size;
        }
      }),
    );
  });

  it("an event missing from the feed is cancelled, and restored if it comes back", () => {
    fc.assert(
      fc.property(feedArb, (feed) => {
        fc.pre(feed.length > 0);
        const rows = new Map<string, Row>();
        apply(rows, planSync([], feed, window));
        const [dropped, ...rest] = feed;
        apply(rows, planSync(stored(rows), rest, window));
        expect(rows.get(dropped.externalId)!.status).toBe("cancelled");
        apply(rows, planSync(stored(rows), feed, window));
        expect(rows.get(dropped.externalId)!.status).toBe("active");
      }),
    );
  });

  it("overrides are never lost; a source change only flags them (CON-5)", () => {
    fc.assert(
      fc.property(feedArb, fc.array(feedArb, { minLength: 1, maxLength: 4 }), (first, later) => {
        const rows = new Map<string, Row>();
        apply(rows, planSync([], first, window));
        for (const row of rows.values()) {
          row.hasOverride = true;
          row.overrideSnapshot = row.sourceHash;
        }
        for (const feed of later) apply(rows, planSync(stored(rows), feed, window));
        for (const row of rows.values()) {
          if (row.overrideSnapshot === null) continue;
          expect(row.hasOverride).toBe(true);
          if (row.sourceHash !== row.overrideSnapshot) expect(row.overrideFlagged).toBe(true);
        }
      }),
    );
  });

  it("only cancels missing events that start inside the sync window", () => {
    const old: SourceRecord = {
      externalId: "old",
      category: "soccer",
      title: "Last season",
      notes: null,
      locationName: null,
      startUtc: new Date("2025-01-01T18:00:00Z"),
      endUtc: new Date("2025-01-01T19:00:00Z"),
      allDay: false,
      attendance: "required",
      sourceUrl: null,
    };
    const row: StoredEvent = {
      id: "1",
      externalId: "old",
      status: "active",
      sourceHash: recordHash(old),
      startUtc: old.startUtc,
      hasOverride: false,
      fields: old,
    };
    expect(planSync([row], [], { from: new Date("2026-01-01T00:00:00Z"), to: null }).items).toEqual([]);
    expect(planSync([row], [], { from: null, to: null }).counts.cancelled).toBe(1);
  });

  it("uses the last of duplicate IDs and reports them", () => {
    fc.assert(
      fc.property(recordArb("dup"), recordArb("dup"), (a, b) => {
        const plan = planSync([], [a, b], window);
        expect(plan.duplicates).toEqual(["dup"]);
        expect(plan.items).toHaveLength(1);
        expect(plan.items[0]).toMatchObject({ op: "insert", record: b });
      }),
    );
  });
});
