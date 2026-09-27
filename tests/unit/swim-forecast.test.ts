import { describe, expect, it } from "vitest";
import { addMonths, backtest, forecast, type ForecastInput } from "@/domain/swim-forecast";

// Plan M2.6: synthetic series with a known curve.
const DAY = 86_400_000;
const curve = (c: number, b: number, halfLifeYears: number) => (years: number) =>
  c + b * Math.exp((-Math.LN2 / halfLifeYears) * years);
const series = (
  f: (y: number) => number,
  start: string,
  months: number[],
  noise: number[] = [],
): ForecastInput =>
  months.map((m, i) => {
    const date = addMonths(start, m);
    const years = (Date.parse(date) - Date.parse(start)) / DAY / 365.25;
    return { swimDate: date, timeMs: Math.round(f(years) + (noise[i] ?? 0)) };
  });

describe("swim forecast (SWM-5, §6.2)", () => {
  const truth = curve(30000, 12000, 1.5);
  const clean = series(truth, "2024-01-15", [0, 2, 4, 6, 8, 10, 12, 15, 18, 21, 24]);
  const today = "2026-01-15";

  it("recovers a known curve and projects 6 and 12 months ahead", () => {
    const f = forecast(clean, today);
    if (f.status !== "ok") throw new Error(f.reason);
    const at = (m: number) =>
      truth((Date.parse(addMonths(today, m)) - Date.parse("2024-01-15")) / DAY / 365.25);
    expect(f.points.map((p) => p.months)).toEqual([6, 12]);
    expect(f.points[0].date).toBe("2026-07-15");
    for (const p of f.points) {
      expect(Math.abs(p.timeMs - at(p.months))).toBeLessThan(400);
      expect(p.lowMs).toBeLessThanOrEqual(p.timeMs);
      expect(p.highMs).toBeGreaterThanOrEqual(p.timeMs);
    }
    // Further out, wider.
    expect(f.points[1].highMs - f.points[1].lowMs).toBeGreaterThan(f.points[0].highMs - f.points[0].lowMs);
    expect(f.curve[0].date).toBe("2024-01-15");
    expect(f.curve.at(-1)!.date).toBe("2027-01-15");
  });

  it("is never faster than the asymptote", () => {
    const f = forecast(clean, "2030-01-01");
    if (f.status !== "ok") throw new Error(f.reason);
    for (const p of f.points) {
      expect(p.timeMs).toBeGreaterThanOrEqual(f.asymptoteMs);
      expect(p.lowMs).toBeGreaterThanOrEqual(f.asymptoteMs);
    }
  });

  it("isn't dragged by one bad swim (robust fit)", () => {
    const noisy = series(truth, "2024-01-15", [0, 2, 4, 6, 8, 10, 12, 15, 18, 21, 24], [0, 0, 0, 0, 0, 6000]);
    const a = forecast(clean, today);
    const b = forecast(noisy, today);
    if (a.status !== "ok" || b.status !== "ok") throw new Error("no forecast");
    expect(Math.abs(a.points[1].timeMs - b.points[1].timeMs)).toBeLessThan(500);
  });

  it("projects no improvement when he isn't getting faster", () => {
    const flat = series(() => 40000, "2024-01-15", [0, 3, 6, 9], [300, -200, 100, -100]);
    const f = forecast(flat, "2024-12-01");
    if (f.status !== "ok") throw new Error(f.reason);
    expect(Math.abs(f.points[1].timeMs - 40000)).toBeLessThan(400);
  });

  it("needs at least 4 swims over at least 6 months", () => {
    expect(forecast(clean.slice(0, 3), today)).toEqual({
      status: "insufficient",
      reason: "Needs at least 4 swims (has 3).",
    });
    const short = series(truth, "2024-01-15", [0, 1, 2, 3, 4, 5]);
    expect(forecast(short, today)).toEqual({
      status: "insufficient",
      reason: "Needs swims spread over at least 6 months.",
    });
  });

  it("backtests on later swims", () => {
    const result = backtest(new Map([["50-free-SCM", clean]]));
    expect(result.rows.length).toBeGreaterThan(3);
    expect(result.medianAbsPct!).toBeLessThan(2);
  });
});
