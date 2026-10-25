import { eq, gte, sql } from "drizzle-orm";
import {
  assistantTurns,
  dailyCosts,
  emailMessages,
  mailItems,
  settings,
  tennisExplanations,
  videoReviewRounds,
} from "@db/schema";
import { summariseCosts, type CostSummary } from "../domain/costs";
import { addDays, localDate } from "../domain/time";
import type { DbOrTx } from "./db/client";
import { costUsd } from "./llm/pricing";
import { getHomeTimeZone } from "./settings";

// What the Costs page shows (intent 0002, COST-1..5).

const KEY = "costs_sync";

export type CostSync = { lastRunAt: string | null; lastError: string | null; currency: string | null };

export async function getCostSync(db: DbOrTx): Promise<CostSync> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return { lastRunAt: null, lastError: null, currency: null, ...((row?.value as Partial<CostSync>) ?? {}) };
}

export async function saveCostSync(db: DbOrTx, patch: Partial<CostSync>) {
  const value = { ...(await getCostSync(db)), ...patch };
  await db
    .insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : null;
};

// `assistant` is Cookie (intent 0007, LIM-6); `mail` today's mail (intent
// 0025, MSEC-5).
export type FeatureDay = {
  day: string;
  video: number;
  email: number;
  explanation: number;
  assistant: number;
  mail: number;
};
type Feature = Exclude<keyof FeatureDay, "day">;

export type CostsView = {
  configured: boolean;
  sync: CostSync;
  currency: string;
  today: string;
  summary: CostSummary;
  // COST-4: estimated from tokens and list prices, in USD.
  features: { days: FeatureDay[]; month: Record<Feature, number> };
};

const r2 = (x: number) => Math.round(x * 100) / 100;

async function featureCosts(db: DbOrTx, from: string, tz: string, month: string) {
  const localDay = (col: unknown) => sql<string>`to_char(${col} at time zone ${tz}, 'YYYY-MM-DD')`;
  const since = new Date(`${from}T00:00:00Z`);
  const [video, email, explanations, assistant, mail] = await Promise.all([
    db
      .select({
        day: localDay(videoReviewRounds.createdAt),
        cost: sql<number>`sum(${videoReviewRounds.costUsd})::float`,
      })
      .from(videoReviewRounds)
      .where(gte(videoReviewRounds.createdAt, since))
      .groupBy(sql`1`),
    db
      .select({
        day: localDay(emailMessages.readAt),
        cost: sql<number>`coalesce(sum(${emailMessages.costUsd}), 0)::float`,
      })
      .from(emailMessages)
      .where(gte(emailMessages.readAt, since))
      .groupBy(sql`1`),
    db
      .select({
        day: localDay(tennisExplanations.createdAt),
        model: tennisExplanations.model,
        input: tennisExplanations.inputTokens,
        output: tennisExplanations.outputTokens,
      })
      .from(tennisExplanations)
      .where(gte(tennisExplanations.createdAt, since)),
    db
      .select({
        day: localDay(assistantTurns.createdAt),
        cost: sql<number>`sum(${assistantTurns.costUsd})::float`,
      })
      .from(assistantTurns)
      .where(gte(assistantTurns.createdAt, since))
      .groupBy(sql`1`),
    db
      .select({
        day: localDay(mailItems.createdAt),
        cost: sql<number>`coalesce(sum(${mailItems.costUsd}), 0)::float`,
      })
      .from(mailItems)
      .where(gte(mailItems.createdAt, since))
      .groupBy(sql`1`),
  ]);
  const byDay = new Map<string, FeatureDay>();
  const at = (day: string) => {
    let d = byDay.get(day);
    if (!d) byDay.set(day, (d = { day, video: 0, email: 0, explanation: 0, assistant: 0, mail: 0 }));
    return d;
  };
  for (const v of video) at(v.day).video += v.cost ?? 0;
  for (const e of email) at(e.day).email += e.cost ?? 0;
  for (const x of explanations)
    at(x.day).explanation += costUsd(x.model, { input: x.input ?? 0, output: x.output ?? 0 });
  for (const a of assistant) at(a.day).assistant += a.cost ?? 0;
  for (const m of mail) at(m.day).mail += m.cost ?? 0;
  const days = [...byDay.values()]
    .map((d) => ({
      day: d.day,
      video: r2(d.video),
      email: r2(d.email),
      explanation: r2(d.explanation),
      assistant: r2(d.assistant),
      mail: r2(d.mail),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const inMonth = days.filter((d) => d.day.startsWith(month));
  const total = (k: Feature) => r2(inMonth.reduce((a, d) => a + d[k], 0));
  return {
    days,
    month: {
      video: total("video"),
      email: total("email"),
      explanation: total("explanation"),
      assistant: total("assistant"),
      mail: total("mail"),
    },
  };
}

export async function loadCosts(db: DbOrTx, now = new Date()): Promise<CostsView> {
  const tz = await getHomeTimeZone(db);
  const today = localDate(now, tz);
  // 90 days on the chart; that always covers all of last month too.
  const from = addDays(today, -89);
  const [rows, sync] = await Promise.all([
    db.select().from(dailyCosts).where(gte(dailyCosts.day, from)),
    getCostSync(db),
  ]);
  const summary = summariseCosts(
    rows.map((r) => ({ day: r.day, service: r.service, cost: r.cost })),
    today,
    { project: num(process.env.MONTHLY_BUDGET), ai: num(process.env.AI_MONTHLY_BUDGET) },
  );
  return {
    configured: !!process.env.BILLING_EXPORT_TABLE?.trim() || rows.length > 0,
    sync,
    currency: sync.currency || rows[0]?.currency || process.env.BUDGET_CURRENCY || "USD",
    today,
    summary,
    features: await featureCosts(db, addDays(today, -89), tz, today.slice(0, 7)),
  };
}
