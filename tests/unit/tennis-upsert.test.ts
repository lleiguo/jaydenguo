import { describe, expect, it } from "vitest";
import {
  matchHash,
  matchKey,
  planMatches,
  planTournaments,
  tournamentHash,
  type StoredMatch,
  type TennisMatchRecord,
  type TennisTournamentRecord,
} from "@/domain/tennis-upsert";

// Plan M3.3 and M3.7 sync rules (SYNC-3, TEN-8, NFR-6).

const SELF = "1";
const window = { from: new Date("2024-09-01T00:00:00Z"), to: null };

function match(over: Partial<TennisMatchRecord> = {}): TennisMatchRecord {
  const side1 = over.side1 ?? [SELF];
  const side2 = over.side2 ?? ["2"];
  return {
    externalId: matchKey("t1", "15", side1, side2),
    tournamentExternalId: "t1",
    drawNo: "15",
    eventName: "U12 Boys Singles",
    round: "Quarter final",
    matchDate: "2024-09-28",
    scheduledAt: null,
    side1,
    side2,
    winner: 1,
    sets: [
      [6, 3],
      [6, 4],
    ],
    outcome: "played",
    ...over,
  };
}

function stored(r: TennisMatchRecord, over: Partial<StoredMatch> = {}): StoredMatch {
  const { externalId, ...values } = r;
  return {
    id: `id-${externalId}`,
    externalId,
    origin: "source",
    status: "active",
    deleted: false,
    corrected: false,
    sourceHash: matchHash(r),
    sourceDisagrees: false,
    values,
    ...over,
  };
}

const tournament = (over: Partial<TennisTournamentRecord> = {}): TennisTournamentRecord => ({
  externalId: "t1",
  name: "Fall Open",
  startDate: "2024-09-26",
  endDate: "2024-09-29",
  venue: null,
  city: null,
  region: null,
  entryDeadline: null,
  categories: ["U12"],
  entered: true,
  sourceUrl: null,
  ...over,
});

describe("matchKey", () => {
  it("is the same whichever player's page the match was read from", () => {
    expect(matchKey("t", "1", ["a"], ["b"])).toBe(matchKey("t", "1", ["b"], ["a"]));
    expect(matchKey("t", "1", ["a", "c"], ["b", "d"])).toBe(matchKey("t", "1", ["d", "b"], ["c", "a"]));
  });
});

describe("planMatches", () => {
  it("is idempotent", () => {
    const r = match();
    const plan = planMatches([stored(r)], [r], { selfKey: SELF, window });
    expect(plan.items).toEqual([]);
    expect(plan.unchanged).toEqual([r.externalId]);
  });

  it("inserts new matches and updates changed ones", () => {
    const a = match();
    const b = match({ side2: ["3"], round: "Semi final", winner: null, sets: [], outcome: "scheduled" });
    const plan = planMatches(
      [stored(a)],
      [
        {
          ...a,
          sets: [
            [7, 5],
            [6, 4],
          ],
        },
        b,
      ],
      { selfKey: SELF, window },
    );
    expect(plan.counts).toEqual({ added: 1, changed: 1, cancelled: 0 });
    expect(plan.items.map((i) => i.op).sort()).toEqual(["insert", "update"]);
  });

  it("never cancels on an empty fetch", () => {
    const plan = planMatches([stored(match())], [], { selfKey: SELF, window });
    expect(plan.items).toEqual([]);
  });

  it("cancels his recent matches the source dropped, but never opponents' matches or old ones", () => {
    const mine = match();
    const theirs = match({ side1: ["2"], side2: ["3"] });
    const old = match({ side2: ["4"], matchDate: "2024-06-01" });
    const still = match({ side2: ["5"] });
    const plan = planMatches([stored(mine), stored(theirs), stored(old), stored(still)], [still], {
      selfKey: SELF,
      window,
    });
    expect(plan.items).toEqual([{ op: "cancel", id: `id-${mine.externalId}`, before: stored(mine).values }]);
  });

  it("restores a cancelled match that comes back", () => {
    const r = match();
    const plan = planMatches([stored(r, { status: "cancelled" })], [r], { selfKey: SELF, window });
    expect(plan.items[0]).toMatchObject({ op: "update", restore: true });
  });

  it("keeps the owner's correction and flags when the source disagrees", () => {
    const source = match();
    const corrected = stored(source, {
      corrected: true,
      values: {
        ...stored(source).values,
        sets: [
          [6, 3],
          [7, 5],
        ],
      },
    });
    const plan = planMatches([corrected], [source], { selfKey: SELF, window });
    expect(plan.items).toEqual([
      expect.objectContaining({ op: "source", disagrees: true, link: false, fill: {} }),
    ]);
    // Once flagged, the same source value changes nothing.
    const again = planMatches([{ ...corrected, sourceDisagrees: true }], [source], { selfKey: SELF, window });
    expect(again.items).toEqual([]);
  });

  it("clears the flag when the source catches up with the correction", () => {
    const source = match();
    const corrected = stored(source, { corrected: true, sourceDisagrees: true, sourceHash: "old" });
    const plan = planMatches([corrected], [source], { selfKey: SELF, window });
    expect(plan.items).toEqual([expect.objectContaining({ op: "source", disagrees: false })]);
  });

  it("flags a corrected match the source stopped listing instead of cancelling it", () => {
    const r = match();
    const other = match({ side2: ["9"] });
    const plan = planMatches([stored(r, { corrected: true }), stored(other)], [other], {
      selfKey: SELF,
      window,
    });
    expect(plan.items).toEqual([
      expect.objectContaining({ op: "source", id: `id-${r.externalId}`, record: null, disagrees: true }),
    ]);
  });

  it("links a hand-entered match to the source's copy, matching the opponent by name", () => {
    const source = match({ scheduledAt: "2024-09-28T14:00:00.000Z" });
    const manual: StoredMatch = {
      ...stored(source),
      id: "manual-1",
      externalId: null,
      origin: "manual",
      sourceHash: null,
      values: {
        ...stored(source).values,
        tournamentExternalId: null,
        drawNo: null,
        round: null,
        scheduledAt: null,
        side2: ["player:typed"],
      },
    };
    const plan = planMatches([manual], [source], {
      selfKey: SELF,
      window,
      sameOpponent: (m, s) => m === "player:typed" && s === "2",
    });
    expect(plan.items).toEqual([
      expect.objectContaining({
        op: "source",
        id: "manual-1",
        link: true,
        disagrees: true, // the owner didn't type the start time
        fill: {
          tournamentExternalId: "t1",
          drawNo: "15",
          round: "Quarter final",
          scheduledAt: source.scheduledAt,
        },
      }),
    ]);
    expect(plan.counts.added).toBe(0);
  });
});

describe("planTournaments", () => {
  it("inserts, skips unchanged and updates changed tournaments", () => {
    const t = tournament();
    const s = {
      id: "x",
      externalId: "t1",
      status: "active" as const,
      entered: true,
      sourceHash: tournamentHash(t),
      startDate: t.startDate,
    };
    expect(planTournaments([s], [t], window)).toEqual([]);
    expect(planTournaments([s], [{ ...t, venue: "Club" }], window)[0]).toMatchObject({
      op: "update",
      id: "x",
    });
    expect(planTournaments([], [t], window)[0]).toMatchObject({ op: "insert" });
  });

  it("cancels only his recent tournaments that vanished, and never on an empty fetch", () => {
    const base = { status: "active" as const, sourceHash: "h" };
    const storedList = [
      { ...base, id: "mine", externalId: "a", entered: true, startDate: "2024-09-20" },
      { ...base, id: "old", externalId: "b", entered: true, startDate: "2024-01-20" },
      { ...base, id: "theirs", externalId: "c", entered: false, startDate: "2024-09-20" },
    ];
    expect(planTournaments(storedList, [], window)).toEqual([]);
    const plan = planTournaments(storedList, [tournament({ externalId: "d" })], window);
    expect(plan.filter((i) => i.op === "cancel")).toEqual([{ op: "cancel", id: "mine" }]);
  });
});
