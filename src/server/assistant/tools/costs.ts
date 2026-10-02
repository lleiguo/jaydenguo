import { z } from "zod";
import { loadCosts } from "../../costs";
import type { Tool } from "./types";

// TOOL-7: what the hub costs to run.
export const costsTool: Tool<Record<string, never>> = {
  name: "costs",
  kind: "hub",
  label: "Costs",
  description:
    "What the hub costs to run: this month so far, the month-end forecast (an estimate), last month, budgets, and AI cost by feature.",
  input: z.object({}),
  async run(ctx) {
    const c = await loadCosts(ctx.db, ctx.now);
    const s = c.summary;
    return {
      currency: c.currency,
      month: s.month,
      monthToDate: s.monthToDate,
      billingDataThrough: s.latestDay,
      forecastEstimate: s.forecast
        ? { total: s.forecast.total.total, low: s.forecast.total.low, high: s.forecast.total.high }
        : undefined,
      lastMonth: s.lastMonth?.total,
      budgets: {
        project: s.budgets.project
          ? { amount: s.budgets.project.amount, percentUsed: s.budgets.project.percent }
          : undefined,
        ai: s.budgets.ai ? { amount: s.budgets.ai.amount, percentUsed: s.budgets.ai.percent } : undefined,
      },
      aiThisMonthUsdEstimate: c.features.month,
      topServices: s.services.slice(0, 5).map((x) => ({ service: x.service, cost: x.cost })),
    };
  },
};
