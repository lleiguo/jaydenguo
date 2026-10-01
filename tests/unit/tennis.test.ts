import { describe, expect, it } from "vitest";
import {
  firstName,
  form,
  formatScore,
  headToHead,
  parseSets,
  perspective,
  withRunningRecord,
  type TennisMatch,
} from "@/domain/tennis";

// TEN-4, TEN-5, TEN-7 read-side rules.

const me = { key: "1", name: "Me" };
const opp = { key: "2", name: "Opp" };
const other = { key: "3", name: "Other" };
let n = 0;
const m = (
  date: string,
  a: typeof me,
  b: typeof me,
  winner: 1 | 2 | null,
  over: Partial<TennisMatch> = {},
): TennisMatch => ({
  id: `m${n++}`,
  matchDate: date,
  scheduledAt: null,
  tournamentId: null,
  tournamentName: null,
  eventName: null,
  round: null,
  sides: [[a], [b]],
  winner,
  sets: winner
    ? [
        [6, 4],
        [3, 6],
        [10, 8],
      ]
    : [],
  outcome: winner ? "played" : "scheduled",
  ...over,
});

describe("scores and results", () => {
  it("shows the score from the player's side, with the match tie-break in brackets", () => {
    expect(
      formatScore([
        [6, 4],
        [3, 6],
        [10, 8],
      ]),
    ).toBe("6–4 3–6 [10–8]");
    expect(
      formatScore(
        [
          [6, 4],
          [3, 6],
          [10, 8],
        ],
        2,
      ),
    ).toBe("4–6 6–3 [8–10]");
    expect(
      formatScore([
        [6, 4],
        [3, 6],
        [7, 5],
      ]),
    ).toBe("6–4 3–6 7–5");
    const match = m("2024-01-01", opp, me, 1);
    expect(perspective(match, "1")).toMatchObject({
      side: 2,
      result: "L",
      score: "4–6 6–3 [8–10]",
      opponents: [opp],
    });
    expect(perspective({ ...match, outcome: "walkover", sets: [] }, "2")).toMatchObject({
      result: "W",
      score: "(walkover)",
    });
    expect(perspective(match, "9")).toBeNull();
  });
});

describe("head-to-head and form", () => {
  const matches = [
    m("2024-01-10", me, opp, 1),
    m("2024-03-10", opp, me, 1),
    m("2024-05-10", me, opp, 1),
    m("2024-06-10", me, opp, null), // not played yet
    m("2024-02-10", opp, other, 1),
    m("2023-01-10", opp, other, 2), // more than a year ago
  ];

  it("lists every meeting, newest first, with the W–L (TEN-4)", () => {
    const h = headToHead(matches, new Set(["1"]), "2");
    expect(h.record).toEqual({ wins: 2, losses: 1 });
    expect(h.meetings.map((x) => x.match.matchDate)).toEqual(["2024-05-10", "2024-03-10", "2024-01-10"]);
  });

  it("gives the last 10 and the 12-month win rate (TEN-5)", () => {
    const f = form(matches, "2", "2024-09-01");
    expect(f.last.map((x) => x.view.result)).toEqual(["L", "W", "W", "L", "L"]);
    expect(f.lastYear).toEqual({ wins: 2, losses: 2 });
    expect(f.winRate).toBe(0.5);
  });

  it("keeps a running W–L oldest to newest, shown newest first (TEN-7)", () => {
    const rows = matches
      .filter((x) => x.winner && perspective(x, "1"))
      .map((x) => ({ match: x, view: perspective(x, "1")! }));
    expect(withRunningRecord(rows).map((r) => [r.match.matchDate, r.running])).toEqual([
      ["2024-05-10", { wins: 2, losses: 1 }],
      ["2024-03-10", { wins: 1, losses: 1 }],
      ["2024-01-10", { wins: 1, losses: 0 }],
    ]);
  });
});

describe("parseSets", () => {
  it("reads a typed score from his side", () => {
    expect(parseSets("6-3 4-6 10-8")).toEqual([
      [6, 3],
      [4, 6],
      [10, 8],
    ]);
    expect(parseSets("6–3, 4–6, [10–8]")).toEqual([
      [6, 3],
      [4, 6],
      [10, 8],
    ]);
    expect(parseSets("")).toEqual([]);
    expect(parseSets("six three")).toBeNull();
  });
});

describe("firstName", () => {
  it("takes the given name either way round", () => {
    expect(firstName("Casey, Alex")).toBe("Alex");
    expect(firstName("Alex Casey")).toBe("Alex");
    expect(firstName("  ")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});
