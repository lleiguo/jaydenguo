import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dailyCosts, settings } from "@db/schema";
import { getCostSync, loadCosts } from "@/server/costs";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createLogger } from "@/server/log";
import { costsSyncJob, syncCosts } from "@/worker/costs";

// The costs job and page data (intent 0002, COST-1..5) against a fake
// BigQuery REST API: a query that finishes on the second poll and returns
// two pages of rows.

type Row = [string, string, string, number];

describe("costs", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let base = "";
  let rows: Row[] = [];
  let status = 200;
  const seen: { query?: string; params?: Record<string, string>; auth?: string } = {};
  const now = new Date("2026-09-20T15:00:00Z");
  const saved: Record<string, string | undefined> = {};
  const log = createLogger(() => {});

  const page = (from: number, token?: string) => ({
    jobComplete: true,
    jobReference: { jobId: "job-1", location: "northamerica-northeast2" },
    schema: { fields: [{ name: "day" }, { name: "service" }, { name: "currency" }, { name: "cost" }] },
    rows: rows.slice(from, from + 2).map((r) => ({ f: r.map((v) => ({ v: String(v) })) })),
    ...(token ? { pageToken: token } : {}),
  });

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    server = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const url = new URL(req.url ?? "/", base);
      const send = (s: number, body: unknown) => {
        res.writeHead(s, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      seen.auth = req.headers.authorization;
      if (status !== 200) return send(status, { error: { code: status } });
      if (req.method === "POST" && url.pathname === "/bigquery/v2/projects/jaydenguo/queries") {
        const body = JSON.parse(raw) as {
          query: string;
          queryParameters: { name: string; parameterValue: { value: string } }[];
        };
        seen.query = body.query;
        seen.params = Object.fromEntries(body.queryParameters.map((p) => [p.name, p.parameterValue.value]));
        // Not finished yet: the client polls.
        return send(200, {
          jobComplete: false,
          jobReference: { jobId: "job-1", location: "northamerica-northeast2" },
        });
      }
      if (url.pathname === "/bigquery/v2/projects/jaydenguo/queries/job-1") {
        const token = url.searchParams.get("pageToken");
        const from = token ? Number(token) : 0;
        return send(200, page(from, from + 2 < rows.length ? String(from + 2) : undefined));
      }
      send(404, {});
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const k of [
      "BIGQUERY_API_BASE",
      "BILLING_EXPORT_TABLE",
      "BILLING_PROJECT",
      "MONTHLY_BUDGET",
      "AI_MONTHLY_BUDGET",
    ])
      saved[k] = process.env[k];
    Object.assign(process.env, {
      BIGQUERY_API_BASE: base,
      BILLING_EXPORT_TABLE: "jaydenguo.billing.gcp_billing_export_v1_000000_AAAAAA_BBBBBB",
      BILLING_PROJECT: "jaydenguo",
      MONTHLY_BUDGET: "80",
      AI_MONTHLY_BUDGET: "40",
    });
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    await db.delete(dailyCosts);
    await db.delete(settings).where(eq(settings.key, "costs_sync"));
    await new Promise((r) => server.close(r));
    await handle.close();
  });
  beforeEach(async () => {
    await db.delete(dailyCosts);
    await db.delete(settings).where(eq(settings.key, "costs_sync"));
    status = 200;
  });

  const token = async () => "bq-token";

  it("reads the export per day and service for this project, and stores it", async () => {
    rows = [
      ["2026-09-18", "Cloud SQL", "CAD", 0.9],
      ["2026-09-18", "Vertex AI", "CAD", 0.4],
      ["2026-09-19", "Cloud SQL", "CAD", 0.9],
      ["2026-09-19", "Cloud Run", "CAD", 0.1],
      ["2026-09-19", "Vertex AI", "CAD", 1.25],
    ];
    const result = await syncCosts(db, token, now);
    expect(result).toEqual({ rows: 5, from: "2026-08-16", currency: "CAD" });
    expect(seen.auth).toBe("Bearer bq-token");
    expect(seen.query).toContain("`jaydenguo.billing.gcp_billing_export_v1_000000_AAAAAA_BBBBBB`");
    expect(seen.query).toContain("UNNEST(credits)");
    expect(seen.params).toMatchObject({ project: "jaydenguo", from: "2026-08-16T00:00:00Z" });
    const stored = await db.select().from(dailyCosts);
    expect(stored).toHaveLength(5);

    const v = await loadCosts(db, now);
    expect(v.currency).toBe("CAD");
    expect(v.summary.monthToDate).toEqual({ total: 3.55, infra: 1.9, ai: 1.65 });
    expect(v.summary.latestDay).toBe("2026-09-19");
    expect(v.summary.budgets.project).toMatchObject({ amount: 80, spent: 3.55 });
    expect(v.summary.services[0]).toEqual({ service: "Cloud SQL", cost: 1.8, ai: false });
  });

  it("replaces the refreshed days with the corrected amounts", async () => {
    rows = [["2026-09-19", "Cloud SQL", "CAD", 0.9]];
    await syncCosts(db, token, now);
    rows = [["2026-09-19", "Cloud SQL", "CAD", 0.95]];
    await syncCosts(db, token, now);
    const stored = await db.select().from(dailyCosts);
    expect(stored.map((r) => r.cost)).toEqual([0.95]);
  });

  it("keeps days older than the refreshed window", async () => {
    await db.insert(dailyCosts).values({ day: "2026-07-01", service: "Cloud SQL", cost: 1, currency: "CAD" });
    rows = [];
    await syncCosts(db, token, now);
    expect((await db.select().from(dailyCosts)).map((r) => r.day)).toEqual(["2026-07-01"]);
  });

  it("says in words when BigQuery refuses, and the job records it", async () => {
    status = 403;
    await expect(syncCosts(db, token, now)).rejects.toThrow(/needs read access to the billing export/);
    // The job itself uses the worker's own identity; whatever fails, it
    // records a plain-language error for the page instead of throwing.
    await costsSyncJob([], { log, db: async () => db });
    expect((await getCostSync(db)).lastError).toBeTruthy();
  });

  it("does nothing without an export table", async () => {
    delete process.env.BILLING_EXPORT_TABLE;
    try {
      expect(await syncCosts(db, token, now)).toEqual({ skipped: "no billing export" });
      expect((await loadCosts(db, now)).configured).toBe(false);
    } finally {
      process.env.BILLING_EXPORT_TABLE = "jaydenguo.billing.gcp_billing_export_v1_000000_AAAAAA_BBBBBB";
    }
  });
});
