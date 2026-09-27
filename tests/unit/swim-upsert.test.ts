import { describe, expect, it } from "vitest";
import {
  planMeets,
  planResults,
  resultHash,
  resultValues,
  type StoredResult,
  type SwimMeetRecord,
  type SwimResultRecord,
} from "@/domain/swim-upsert";

const rec = (
  externalId: string,
  timeMs: number | null,
  extra: Partial<SwimResultRecord> = {},
): SwimResultRecord => ({
  externalId,
  meetExternalId: "signup:m1",
  swimDate: "2025-05-10",
  distance: 100,
  stroke: "free",
  course: "SCM",
  timeMs,
  place: 3,
  heat: 2,
  lane: 4,
  stage: "Final",
  dqReason: null,
  splits: [],
  ...extra,
});

const stored = (r: SwimResultRecord, extra: Partial<StoredResult> = {}): StoredResult => {
  return {
    id: `row-${r.externalId}`,
    externalId: r.externalId,
    origin: "source",
    status: "active",
    deleted: false,
    corrected: false,
    sourceHash: resultHash(r),
    sourceDisagrees: false,
    values: resultValues(r),
    ...extra,
  };
};

describe("swim result sync rules (SYNC-3, SWM-7)", () => {
  it("inserts new swims and changes nothing on a second run", () => {
    const first = planResults([], [rec("a", 70000)]);
    expect(first.counts).toEqual({ added: 1, changed: 0, cancelled: 0 });
    const second = planResults([stored(rec("a", 70000))], [rec("a", 70000)]);
    expect(second.items).toEqual([]);
    expect(second.unchanged).toEqual(["a"]);
  });

  it("updates an uncorrected swim when the source changes it", () => {
    const plan = planResults([stored(rec("a", 70000))], [rec("a", 69900)]);
    expect(plan.items).toEqual([expect.objectContaining({ op: "update", id: "row-a", restore: false })]);
  });

  it("never overwrites a correction; flags it when the source disagrees", () => {
    const corrected = stored(rec("a", 70000), {
      corrected: true,
      values: { ...rec("a", 69000), meetExternalId: "signup:m1" },
    });
    const plan = planResults([corrected], [rec("a", 70000)]);
    expect(plan.items).toEqual([
      {
        op: "source",
        id: "row-a",
        record: rec("a", 70000),
        hash: resultHash(rec("a", 70000)),
        disagrees: true,
        fill: {},
        link: false,
      },
    ]);
    // Already flagged and nothing new: no change.
    const again = planResults([{ ...corrected, sourceDisagrees: true }], [rec("a", 70000)]);
    expect(again.items).toEqual([]);
    // The source comes round to the owner's time: the flag clears.
    const agrees = planResults([{ ...corrected, sourceDisagrees: true }], [rec("a", 69000)]);
    expect(agrees.items).toEqual([expect.objectContaining({ op: "source", disagrees: false })]);
  });

  it("links an owner-entered swim to the source's copy instead of adding a second", () => {
    const values = resultValues(
      rec("x", 70000, { place: null, heat: null, lane: null, stage: null, meetExternalId: null }),
    );
    const manual: StoredResult = {
      id: "manual-1",
      externalId: null,
      origin: "manual",
      status: "active",
      deleted: false,
      corrected: false,
      sourceHash: null,
      sourceDisagrees: false,
      values,
    };
    const plan = planResults([manual], [rec("a", 70010)]);
    expect(plan.counts).toEqual({ added: 0, changed: 1, cancelled: 0 });
    expect(plan.items).toEqual([
      {
        op: "source",
        id: "manual-1",
        record: rec("a", 70010),
        hash: resultHash(rec("a", 70010)),
        disagrees: true,
        // Blanks the owner left are filled; the time stays the owner's.
        fill: { meetExternalId: "signup:m1", place: 3, heat: 2, lane: 4, stage: "Final" },
        link: true,
      },
    ]);
    // A deleted manual row isn't reused.
    expect(planResults([{ ...manual, deleted: true }], [rec("a", 70010)]).items[0].op).toBe("insert");
    // A different event isn't the same swim.
    expect(planResults([manual], [rec("a", 70010, { stroke: "back" })]).items[0].op).toBe("insert");
  });

  it("cancels swims the source stopped listing, but keeps the owner's", () => {
    const plan = planResults(
      [stored(rec("a", 70000)), stored(rec("b", 71000)), stored(rec("c", 72000), { corrected: true })],
      [rec("a", 70000)],
    );
    expect(plan.items).toEqual([
      { op: "cancel", id: "row-b", before: expect.any(Object) },
      { op: "source", id: "row-c", record: null, hash: null, disagrees: true, fill: {}, link: false },
    ]);
  });

  it("cancels nothing on an empty fetch (NFR-6)", () => {
    expect(planResults([stored(rec("a", 70000))], []).items).toEqual([]);
  });

  it("restores a cancelled swim the source lists again", () => {
    const plan = planResults([stored(rec("a", 70000), { status: "cancelled" })], [rec("a", 70000)]);
    expect(plan.items).toEqual([expect.objectContaining({ op: "update", restore: true })]);
  });
});

describe("swim meet sync rules", () => {
  const meet = (externalId: string, startDate: string): SwimMeetRecord => ({
    externalId,
    name: externalId,
    course: "SCM",
    startDate,
    endDate: startDate,
    venue: null,
    city: null,
    signup: "yes",
    sourceUrl: null,
    entries: [],
  });
  const window = { from: new Date("2025-06-01T00:00:00Z"), to: null };

  it("cancels only recent or future meets that vanished, and never on an empty fetch", () => {
    const storedMeets = [
      { id: "1", externalId: "old", status: "active" as const, sourceHash: "x", startDate: "2025-01-01" },
      { id: "2", externalId: "soon", status: "active" as const, sourceHash: "x", startDate: "2025-07-01" },
    ];
    const plan = planMeets(storedMeets, [meet("new", "2025-08-01")], window);
    expect(plan.map((i) => i.op)).toEqual(["insert", "cancel"]);
    expect(plan[1]).toEqual({ op: "cancel", id: "2" });
    expect(planMeets(storedMeets, [], window)).toEqual([]);
  });
});
