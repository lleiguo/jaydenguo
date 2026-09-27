import { describe, expect, it } from "vitest";
import { DEFAULT_RATING, expectedScore, ratePeriods, updateRating } from "@/domain/glicko2";

// Plan M3.5: Glicko-2 against the worked example in Glickman's paper
// ("Example of the Glicko-2 system", section "Example calculation").

describe("Glicko-2", () => {
  it("matches the paper's worked example", () => {
    const player = { rating: 1500, rd: 200, vol: 0.06 };
    const next = updateRating(player, [
      { opponent: { rating: 1400, rd: 30, vol: 0.06 }, score: 1 },
      { opponent: { rating: 1550, rd: 100, vol: 0.06 }, score: 0 },
      { opponent: { rating: 1700, rd: 300, vol: 0.06 }, score: 0 },
    ]);
    // The paper gives r' = 1464.06, RD' = 151.52 and σ' = 0.05999 (0.059996 before truncation).
    expect(next.rating).toBeCloseTo(1464.06, 1);
    expect(next.rd).toBeCloseTo(151.52, 1);
    expect(next.vol).toBeCloseTo(0.059996, 6);
  });

  it("grows the deviation of a player who didn't play, up to the starting value", () => {
    const next = updateRating({ rating: 1600, rd: 50, vol: 0.06 }, []);
    expect(next.rating).toBe(1600);
    expect(next.rd).toBeCloseTo(Math.sqrt((50 / 173.7178) ** 2 + 0.06 ** 2) * 173.7178, 6);
    expect(updateRating(DEFAULT_RATING, []).rd).toBe(350);
  });

  it("gives even odds for equal ratings, and favours the higher-rated player", () => {
    const a = { rating: 1500, rd: 50, vol: 0.06 };
    expect(expectedScore(a, a)).toBeCloseTo(0.5, 10);
    const strong = { rating: 1700, rd: 50, vol: 0.06 };
    const p = expectedScore(strong, a);
    expect(p).toBeGreaterThan(0.7);
    expect(expectedScore(a, strong)).toBeCloseTo(1 - p, 10);
    // More uncertainty pulls the estimate toward 50%.
    expect(expectedScore({ ...strong, rd: 300 }, { ...a, rd: 300 })).toBeLessThan(p);
  });

  it("rates a set of results period by period", () => {
    const results = [
      { period: "2024-01", a: "x", b: "y", score: 1 as const },
      { period: "2024-01", a: "x", b: "z", score: 1 as const },
      { period: "2024-03", a: "y", b: "z", score: 1 as const },
    ];
    const seen: string[] = [];
    const ratings = ratePeriods(results, (period, before) => seen.push(`${period}:${before.size}`));
    expect(seen).toEqual(["2024-01:0", "2024-03:3"]);
    expect(ratings.get("x")!.rating).toBeGreaterThan(ratings.get("y")!.rating);
    expect(ratings.get("y")!.rating).toBeGreaterThan(ratings.get("z")!.rating);
  });
});
