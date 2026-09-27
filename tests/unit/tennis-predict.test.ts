import { describe, expect, it } from "vitest";
import type { TennisMatch } from "@/domain/tennis";
import { backtest, bandOf, buildModel, predict, ratedResults, whyLine } from "@/domain/tennis-predict";

// Plan M3.5: predictions and the backtest (TEN-6, spec §6.1).

let n = 0;
function played(
  date: string,
  a: string,
  b: string,
  winner: 1 | 2,
  sets: [number, number][] = [
    [6, 3],
    [6, 4],
  ],
): TennisMatch {
  const s = winner === 1 ? sets : sets.map(([x, y]) => [y, x] as [number, number]);
  return {
    id: `m${n++}`,
    matchDate: date,
    scheduledAt: null,
    tournamentId: null,
    tournamentName: null,
    eventName: null,
    round: null,
    sides: [[{ key: a, name: a }], [{ key: b, name: b }]],
    winner,
    sets: s,
    outcome: "played",
  };
}

// A league where the stronger player (lower number) nearly always wins.
function league(months: number): TennisMatch[] {
  const out: TennisMatch[] = [];
  const players = ["p1", "p2", "p3", "p4", "p5", "p6"];
  let upset = 0;
  for (let m = 0; m < months; m++) {
    const date = `2023-${String((m % 12) + 1).padStart(2, "0")}-15`.replace(
      "2023",
      String(2023 + Math.floor(m / 12)),
    );
    for (let i = 0; i < players.length; i++)
      for (let j = i + 1; j < players.length; j++) {
        const upsetNow = ++upset % 7 === 0;
        out.push(played(date, players[i], players[j], upsetNow ? 2 : 1));
      }
  }
  return out;
}

describe("predict", () => {
  it("is symmetric and favours the stronger player", () => {
    const model = buildModel(ratedResults(league(6)));
    const p = predict(model, "p1", "p6");
    expect(p.probability).toBeGreaterThan(0.8);
    expect(predict(model, "p6", "p1").probability).toBeCloseTo(1 - p.probability, 6);
    expect(p.band).toBe("Likely a straight-sets win");
    expect(p.confidence).not.toBe("low");
  });

  it("says low confidence when either player has fewer than 5 rated matches", () => {
    const results = ratedResults([...league(6), played("2023-06-20", "p1", "new", 1)]);
    const p = predict(buildModel(results), "p1", "new");
    expect(p.b.ratedMatches).toBe(1);
    expect(p.confidence).toBe("low");
    // Nobody known at all: a coin toss.
    expect(predict(buildModel([]), "x", "y").probability).toBeCloseTo(0.5, 6);
  });

  it("keeps the adjustments small", () => {
    // p2 beat p1 in every one of 5 meetings, by a lot, but lost to others.
    const matches = league(4);
    for (let i = 0; i < 5; i++)
      matches.push(
        played(`2023-05-0${i + 1}`, "p2", "p1", 1, [
          [6, 0],
          [6, 0],
        ]),
      );
    const p = predict(buildModel(ratedResults(matches)), "p2", "p1");
    const logit = (x: number) => Math.log(x / (1 - x));
    expect(p.headToHead.wins).toBeGreaterThan(p.headToHead.losses);
    expect(p.adjustments.headToHead).toBeGreaterThan(0);
    // However strong the signals, together they move the log-odds by 0.6 at most.
    expect(logit(p.probability) - logit(p.base)).toBeGreaterThan(0);
    expect(Math.abs(logit(p.probability) - logit(p.base))).toBeLessThanOrEqual(0.6 + 1e-9);
  });

  it("ignores walkovers, doubles and unplayed matches", () => {
    const wo = { ...played("2024-01-01", "a", "b", 1), outcome: "walkover" as const };
    const dbl: TennisMatch = {
      ...played("2024-01-01", "a", "b", 1),
      sides: [
        [
          { key: "a", name: "a" },
          { key: "c", name: "c" },
        ],
        [
          { key: "b", name: "b" },
          { key: "d", name: "d" },
        ],
      ],
    };
    const sched = {
      ...played("2024-01-01", "a", "b", 1),
      winner: null,
      sets: [],
      outcome: "scheduled" as const,
    };
    expect(ratedResults([wo, dbl, sched])).toEqual([]);
  });

  it("explains its inputs", () => {
    const model = buildModel(ratedResults(league(3)));
    const line = whyLine(predict(model, "p1", "p2"), ["Sam", "Alex"]);
    expect(line).toMatch(
      /^Ratings \d+ ± \d+ vs \d+ ± \d+ · head-to-head \d+–\d+ · last 10: Sam \d+–\d+, Alex \d+–\d+/,
    );
  });

  it("describes score bands", () => {
    expect([0.9, 0.7, 0.5, 0.3, 0.1].map(bandOf)).toEqual([
      "Likely a straight-sets win",
      "More likely a win; a third set is possible",
      "Close: likely to go to a third set",
      "More likely a loss; a third set is possible",
      "Likely a straight-sets loss",
    ]);
  });
});

describe("backtest", () => {
  it("predicts every match from earlier months only, and is well above chance on a clear league", () => {
    const results = ratedResults(league(18));
    const bt = backtest(results);
    expect(bt.n).toBe(results.length);
    expect(bt.accuracy!).toBeGreaterThan(0.75);
    expect(bt.buckets.reduce((s, b) => s + b.n, 0)).toBe(bt.n);
    // The first month has no history: every call is 50%.
    const first = backtest(results.filter((r) => r.date.startsWith("2023-01")));
    expect(first.buckets[0].n).toBe(first.n);
    expect(first.buckets[0].predicted).toBeCloseTo(0.5, 6);
  });
});
