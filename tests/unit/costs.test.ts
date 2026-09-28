import { describe, expect, it } from "vitest";
import { isAiService, summariseCosts, type CostRow } from "@/domain/costs";
import { addDays } from "@/domain/time";

// Every day from `from` to `to`: Cloud SQL `infra` and Vertex AI `ai`.
function span(from: string, to: string, infra: number, ai = 0): CostRow[] {
  const rows: CostRow[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    rows.push({ day: d, service: "Cloud SQL", cost: infra });
    if (ai) rows.push({ day: d, service: "Vertex AI", cost: ai });
  }
  return rows;
}

describe("summariseCosts", () => {
  it("adds up month to date, split into infrastructure and AI", () => {
    const s = summariseCosts(span("2026-09-01", "2026-09-10", 1, 0.5), "2026-09-11");
    expect(s.monthToDate).toEqual({ total: 15, infra: 10, ai: 5 });
    expect(s.latestDay).toBe("2026-09-10");
    expect(s.services).toEqual([
      { service: "Cloud SQL", cost: 10, ai: false },
      { service: "Vertex AI", cost: 5, ai: true },
    ]);
  });

  it("forecasts the month from the recent daily average, with a range", () => {
    // 1 a day, then 3 a day for the last 7 days; data through the 20th of 30.
    const rows = [...span("2026-08-20", "2026-09-13", 1), ...span("2026-09-14", "2026-09-20", 3)];
    const s = summariseCosts(rows, "2026-09-21");
    // Month to date: 13×1 + 7×3 = 34. Last 14 days average 2; 10 days left.
    expect(s.monthToDate.total).toBe(34);
    expect(s.forecast!.total).toEqual({ total: 54, low: 44, high: 64, basisDays: 14 });
  });

  it("gives no forecast with under three days of data", () => {
    expect(summariseCosts(span("2026-09-19", "2026-09-20", 1), "2026-09-21").forecast).toBeNull();
  });

  it("counts days with no billing rows as zero in the average", () => {
    const rows = [...span("2026-09-01", "2026-09-01", 14), ...span("2026-09-14", "2026-09-14", 0)];
    const s = summariseCosts(rows, "2026-09-15");
    expect(s.forecast!.total.basisDays).toBe(14);
    // 14 over 14 days = 1 a day; 16 days left after the 14th.
    expect(s.forecast!.total.total).toBe(14 + 16);
  });

  it("forecasts nothing more once the month's data is complete", () => {
    const s = summariseCosts(span("2026-09-01", "2026-09-30", 1), "2026-10-01");
    // Today is in October: month to date is October's, which has no data yet.
    expect(s.month).toBe("2026-10");
    expect(s.monthToDate.total).toBe(0);
    expect(s.forecast!.total.total).toBe(0);
  });

  it("compares with last month, only when the export covers all of it", () => {
    const full = summariseCosts(span("2026-08-01", "2026-09-10", 2), "2026-09-11");
    expect(full.lastMonth).toEqual({ total: 62, toSameDay: 20 });
    expect(summariseCosts(span("2026-08-15", "2026-09-10", 2), "2026-09-11").lastMonth).toBeNull();
  });

  it("shows budgets against month to date and forecast", () => {
    const s = summariseCosts(span("2026-09-01", "2026-09-10", 3, 1), "2026-09-11", { project: 80, ai: 40 });
    expect(s.budgets.project).toMatchObject({ amount: 80, spent: 40, percent: 50 });
    expect(s.budgets.ai).toMatchObject({ amount: 40, spent: 10, percent: 25 });
    expect(s.budgets.project!.forecast).toBe(120);
  });

  it("lists 90 days, oldest first, with empty days as zero", () => {
    const s = summariseCosts([], "2026-09-11");
    expect(s.days).toHaveLength(90);
    expect(s.days.at(-1)).toEqual({ day: "2026-09-11", infra: 0, ai: 0, total: 0 });
    expect(s.forecast).toBeNull();
    expect(s.latestDay).toBeNull();
  });

  it("keeps credits (negative amounts) in the totals", () => {
    const s = summariseCosts(
      [
        { day: "2026-09-01", service: "Cloud Run", cost: 2 },
        { day: "2026-09-01", service: "Cloud Run credit", cost: -0.5 },
      ],
      "2026-09-02",
    );
    expect(s.monthToDate.total).toBe(1.5);
  });
});

describe("isAiService", () => {
  it("knows the AI billing services", () => {
    expect(isAiService("Vertex AI")).toBe(true);
    expect(isAiService("Claude Opus 5 (Anthropic)")).toBe(true);
    expect(isAiService("Cloud SQL")).toBe(false);
  });
});
