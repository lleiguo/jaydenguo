import { addDays } from "./time";

// The costs dashboard's numbers (intent 0002, COST-1..3): daily totals split
// into infrastructure and AI, month to date, a forecast for the month with a
// range, last month, and the budgets. Pure, so the edge cases are tested.

export type CostRow = { day: string; service: string; cost: number };

// Billing services that are AI: Gemini bills as Vertex AI; partner models
// such as Claude may show under their own names.
export const isAiService = (service: string) => /vertex ai|gemini|claude|anthropic/i.test(service);

export type DayTotal = { day: string; infra: number; ai: number; total: number };

export type Forecast = { total: number; low: number; high: number; basisDays: number };

export type CostSummary = {
  days: DayTotal[];
  // The last day with billing data; later days aren't in yet.
  latestDay: string | null;
  month: string; // YYYY-MM
  monthToDate: { total: number; infra: number; ai: number };
  forecast: { total: Forecast; ai: Forecast } | null;
  lastMonth: { total: number; toSameDay: number } | null;
  services: { service: string; cost: number; ai: boolean }[];
  budgets: { project: Budget | null; ai: Budget | null };
};

export type Budget = { amount: number; spent: number; forecast: number | null; percent: number };

const r2 = (x: number) => Math.round(x * 100) / 100;
const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const prevMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

// Minimum full days of history before a forecast is shown.
const MIN_BASIS = 3;
const BASIS = 14;
const WINDOW = 7;

function forecastFor(
  daily: Map<string, number>,
  firstDay: string,
  latestDay: string,
  spent: number,
  month: string,
): Forecast | null {
  const basis: number[] = [];
  for (let i = 0; i < BASIS; i++) {
    const d = addDays(latestDay, -i);
    if (d < firstDay) break;
    basis.unshift(daily.get(d) ?? 0);
  }
  if (basis.length < MIN_BASIS) return null;
  const remaining = latestDay.startsWith(month) ? daysInMonth(month) - Number(latestDay.slice(8, 10)) : 0;
  const mean = basis.reduce((a, b) => a + b, 0) / basis.length;
  const windows: number[] = [];
  const w = Math.min(WINDOW, basis.length);
  for (let i = 0; i + w <= basis.length; i++)
    windows.push(basis.slice(i, i + w).reduce((a, b) => a + b, 0) / w);
  return {
    total: r2(spent + remaining * mean),
    low: r2(spent + remaining * Math.min(...windows)),
    high: r2(spent + remaining * Math.max(...windows)),
    basisDays: basis.length,
  };
}

export function summariseCosts(
  rows: CostRow[],
  today: string,
  budgets: { project: number | null; ai: number | null } = { project: null, ai: null },
  historyDays = 90,
): CostSummary {
  const month = today.slice(0, 7);
  const byDay = new Map<string, DayTotal>();
  const services = new Map<string, number>();
  let firstDay: string | null = null;
  let latestDay: string | null = null;
  for (const r of rows) {
    if (r.day > today) continue;
    const t = byDay.get(r.day) ?? { day: r.day, infra: 0, ai: 0, total: 0 };
    if (isAiService(r.service)) t.ai += r.cost;
    else t.infra += r.cost;
    t.total += r.cost;
    byDay.set(r.day, t);
    if (!firstDay || r.day < firstDay) firstDay = r.day;
    if (!latestDay || r.day > latestDay) latestDay = r.day;
    if (r.day.startsWith(month)) services.set(r.service, (services.get(r.service) ?? 0) + r.cost);
  }

  const days: DayTotal[] = [];
  for (let i = historyDays - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const t = byDay.get(d) ?? { day: d, infra: 0, ai: 0, total: 0 };
    days.push({ day: d, infra: r2(t.infra), ai: r2(t.ai), total: r2(t.total) });
  }

  const inMonth = [...byDay.values()].filter((t) => t.day.startsWith(month));
  const sum = (xs: DayTotal[], k: "infra" | "ai" | "total") => r2(xs.reduce((a, t) => a + t[k], 0));
  const monthToDate = { total: sum(inMonth, "total"), infra: sum(inMonth, "infra"), ai: sum(inMonth, "ai") };

  let forecast: CostSummary["forecast"] = null;
  if (firstDay && latestDay) {
    const total = forecastFor(
      new Map([...byDay].map(([d, t]) => [d, t.total])),
      firstDay,
      latestDay,
      monthToDate.total,
      month,
    );
    const ai = forecastFor(
      new Map([...byDay].map(([d, t]) => [d, t.ai])),
      firstDay,
      latestDay,
      monthToDate.ai,
      month,
    );
    if (total && ai) forecast = { total, ai };
  }

  const last = prevMonth(month);
  const lastRows = [...byDay.values()].filter((t) => t.day.startsWith(last));
  // Only when the export covers the whole of last month.
  const lastMonth =
    firstDay && firstDay <= `${last}-01`
      ? {
          total: sum(lastRows, "total"),
          toSameDay: sum(
            lastRows.filter((t) => Number(t.day.slice(8, 10)) <= Number((latestDay ?? today).slice(8, 10))),
            "total",
          ),
        }
      : null;

  const budget = (amount: number | null, spent: number, fc: number | null): Budget | null =>
    amount && amount > 0
      ? { amount, spent, forecast: fc, percent: Math.round((spent / amount) * 100) }
      : null;

  return {
    days,
    latestDay,
    month,
    monthToDate,
    forecast,
    lastMonth,
    services: [...services]
      .map(([service, cost]) => ({ service, cost: r2(cost), ai: isAiService(service) }))
      .filter((s) => Math.abs(s.cost) >= 0.005)
      .sort((a, b) => b.cost - a.cost),
    budgets: {
      project: budget(budgets.project, monthToDate.total, forecast?.total.total ?? null),
      ai: budget(budgets.ai, monthToDate.ai, forecast?.ai.total ?? null),
    },
  };
}

// AI cost per feature per day, from each call's recorded cost (COST-4).
export type FeatureCost = { day: string; feature: "video" | "email" | "explanation"; costUsd: number };
