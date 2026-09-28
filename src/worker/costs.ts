import { and, gte, sql } from "drizzle-orm";
import { GoogleAuth } from "google-auth-library";
import { dailyCosts } from "@db/schema";
import { addDays, localDate } from "../domain/time";
import { saveCostSync } from "../server/costs";
import type { Db } from "../server/db/client";
import { getHomeTimeZone } from "../server/settings";
import type { JobContext } from "./context";

// `costs:sync` (intent 0002, COST-1, COST-5): reads the last 35 days of the
// Cloud Billing export in BigQuery for this project, per day (home time
// zone) and service, net of credits, and replaces those days in
// `daily_costs`. Billing data is corrected for a few days after the fact,
// hence the overlap. Read-only in BigQuery.

const DAYS = 35;
const bigQueryBase = () => process.env.BIGQUERY_API_BASE ?? "https://bigquery.googleapis.com";

export class CostsError extends Error {}

// "project.dataset.table", checked because it goes into the SQL text.
export function exportTable(): string | null {
  const t = process.env.BILLING_EXPORT_TABLE?.trim();
  if (!t) return null;
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]\.[A-Za-z0-9_]{1,1024}\.[A-Za-z0-9_]{1,1024}$/.test(t))
    throw new CostsError("BILLING_EXPORT_TABLE must look like project.dataset.table.");
  return t;
}

export function costsQuery(table: string) {
  return `SELECT FORMAT_DATE('%F', DATE(usage_start_time, @tz)) AS day,
  service.description AS service,
  currency,
  SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS cost
FROM \`${table}\`
WHERE project.id = @project AND usage_start_time >= TIMESTAMP(@from)
GROUP BY day, service, currency`;
}

type QueryResponse = {
  jobComplete?: boolean;
  jobReference?: { jobId: string; location?: string };
  schema?: { fields: { name: string }[] };
  rows?: { f: { v: string | null }[] }[];
  pageToken?: string;
};

export type TokenSource = () => Promise<string>;

const defaultToken: TokenSource = async () => {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/bigquery.readonly"] });
  const token = await (await auth.getClient()).getAccessToken();
  if (!token.token) throw new CostsError("No Google Cloud credentials for BigQuery.");
  return token.token;
};

async function bq(token: string, method: string, path: string, body?: unknown): Promise<QueryResponse> {
  const res = await fetch(new URL(`/bigquery/v2/${path}`, bigQueryBase()), {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  if (res.status === 403)
    throw new CostsError("BigQuery refused: the worker needs read access to the billing export dataset.");
  if (res.status === 404)
    throw new CostsError("The billing export table wasn't found. Check BILLING_EXPORT_TABLE.");
  if (!res.ok) throw new CostsError(`BigQuery answered with an error (${res.status}).`);
  return (await res.json()) as QueryResponse;
}

export type BillingRow = { day: string; service: string; currency: string; cost: number };

export async function queryBilling(
  table: string,
  project: string,
  timeZone: string,
  from: string,
  token: TokenSource = defaultToken,
): Promise<BillingRow[]> {
  const t = await token();
  const param = (name: string, value: string) => ({
    name,
    parameterType: { type: "STRING" },
    parameterValue: { value },
  });
  let res = await bq(t, "POST", `projects/${encodeURIComponent(project)}/queries`, {
    query: costsQuery(table),
    useLegacySql: false,
    parameterMode: "NAMED",
    queryParameters: [param("tz", timeZone), param("project", project), param("from", from)],
    timeoutMs: 60_000,
  });
  const job = res.jobReference;
  const more = (pageToken?: string) => {
    const q = new URLSearchParams({ timeoutMs: "60000" });
    if (job?.location) q.set("location", job.location);
    if (pageToken) q.set("pageToken", pageToken);
    return bq(t, "GET", `projects/${encodeURIComponent(project)}/queries/${job!.jobId}?${q}`);
  };
  for (let i = 0; !res.jobComplete; i++) {
    if (!job || i >= 5) throw new CostsError("The billing query took too long. It will be tried again.");
    res = await more();
  }
  const rows: BillingRow[] = [];
  for (;;) {
    const names = res.schema?.fields.map((f) => f.name) ?? [];
    for (const r of res.rows ?? []) {
      const v = Object.fromEntries(names.map((n, i) => [n, r.f[i]?.v]));
      rows.push({
        day: String(v.day),
        service: String(v.service ?? "Other"),
        currency: String(v.currency ?? ""),
        cost: Number(v.cost ?? 0),
      });
    }
    if (!res.pageToken) break;
    res = await more(res.pageToken);
  }
  return rows;
}

export async function syncCosts(db: Db, token?: TokenSource, now = new Date()) {
  const table = exportTable();
  if (!table) return { skipped: "no billing export" as const };
  const project = process.env.BILLING_PROJECT ?? process.env.VERTEX_PROJECT;
  if (!project) throw new CostsError("BILLING_PROJECT isn't set.");
  const tz = await getHomeTimeZone(db);
  const from = addDays(localDate(now, tz), -DAYS);
  const rows = await queryBilling(table, project, tz, `${from}T00:00:00Z`, token);
  // Billing uses one currency per account.
  const currency = rows.find((r) => r.currency)?.currency ?? "";
  await db.transaction(async (tx) => {
    await tx.delete(dailyCosts).where(and(gte(dailyCosts.day, from)));
    // One row per day and service (a service can span two currencies only if
    // the account changed currency; sum them).
    const merged = new Map<string, { day: string; service: string; cost: number }>();
    for (const r of rows) {
      if (r.day < from) continue;
      const k = `${r.day}|${r.service}`;
      const m = merged.get(k) ?? { day: r.day, service: r.service, cost: 0 };
      m.cost += r.cost;
      merged.set(k, m);
    }
    if (merged.size)
      await tx
        .insert(dailyCosts)
        .values(
          [...merged.values()].map((m) => ({ ...m, cost: Math.round(m.cost * 10_000) / 10_000, currency })),
        )
        .onConflictDoUpdate({
          target: [dailyCosts.day, dailyCosts.service],
          set: { cost: sql`excluded.cost`, currency: sql`excluded.currency`, updatedAt: new Date() },
        });
  });
  return { rows: rows.length, from, currency };
}

export async function costsSyncJob(_args: string[], ctx: JobContext) {
  const db = await ctx.db();
  try {
    const result = await syncCosts(db);
    await saveCostSync(db, {
      lastRunAt: new Date().toISOString(),
      lastError: null,
      ...("currency" in result && result.currency ? { currency: result.currency } : {}),
    });
    ctx.log("costs synced", result);
  } catch (err) {
    const message =
      err instanceof CostsError ? err.message : "Reading the billing export failed. It will be tried again.";
    await saveCostSync(db, { lastRunAt: new Date().toISOString(), lastError: message });
    ctx.log("costs sync failed", { error: err }, "WARNING");
  }
}
