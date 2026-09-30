import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sources, syncRuns } from "@db/schema";
import { createCredential } from "@/server/credentials/store";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createLogger, forgetSecrets } from "@/server/log";
import { syncSource } from "@/worker/sync";

// Plan M1.5: the sync framework end to end against Postgres and a local feed.

const feed = readFileSync("tests/fixtures/ical/teamsnap-style.ics", "utf8");

describe("syncSource", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let base: string;
  let serveStatus = 200;
  const lines: string[] = [];
  const log = createLogger((l) => lines.push(l));
  // The fixture's events are in Oct-Nov 2026.
  const now = () => new Date("2026-10-01T12:00:00Z");

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    server = createServer((_req, res) => {
      res.writeHead(serveStatus, { "content-type": "text/calendar" });
      res.end(serveStatus === 200 ? feed : "nope");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.close();
    await handle.close();
  });
  beforeEach(() => {
    serveStatus = 200;
    lines.length = 0;
    forgetSecrets();
    delete process.env.SYNC_MIN_GAP_MINUTES;
  });

  async function newSource(secretPath: string) {
    const cred = await createCredential(db, "test", {
      kind: "secret_url",
      provider: "teamsnap",
      label: "feed",
      secret: `${base}/${secretPath}`,
    });
    const [s] = await db
      .insert(sources)
      .values({ kind: "ical", name: "Soccer", credentialId: cred.id, categoryMapping: { default: "soccer" } })
      .returning();
    return s.id;
  }

  it("syncs a feed and records the run with counts; the log has no secret (SYNC-1, CRED-5)", async () => {
    const token = `tok-${Date.now()}`;
    const id = await newSource(`ical/${token}.ics`);
    const result = await syncSource(db, id, "manual", log, now);
    expect(result).toEqual({ status: "succeeded", added: 7, changed: 0, cancelled: 0 });
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.sourceId, id));
    expect(run).toMatchObject({ status: "succeeded", added: 7, trigger: "manual" });
    expect(run.finishedAt).not.toBeNull();
    expect(lines.join("\n")).toContain("sync finished");
    expect(lines.join("\n")).not.toContain(token);
  });

  it("a feed refreshes again straight away, and a re-run changes nothing (SYNC-3, SYNC-5)", async () => {
    const id = await newSource("ical/b.ics");
    await syncSource(db, id, "manual", log, now);
    expect(await syncSource(db, id, "manual", log, now)).toEqual({
      status: "succeeded",
      added: 0,
      changed: 0,
      cancelled: 0,
    });
  });

  it("two refreshes at once give one run (SYNC-2)", async () => {
    const id = await newSource("ical/c.ics");
    const results = await Promise.all([
      syncSource(db, id, "manual", log, now),
      syncSource(db, id, "manual", log, now),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["skipped", "succeeded"]);
    expect(await db.select().from(syncRuns).where(eq(syncRuns.sourceId, id))).toHaveLength(1);
  });

  it("records a plain-language error and alerts after three failures in a row (SYNC-4)", async () => {
    process.env.SYNC_MIN_GAP_MINUTES = "0";
    const id = await newSource("ical/d.ics");
    serveStatus = 404;
    for (let i = 0; i < 3; i++) {
      expect(await syncSource(db, id, "scheduled", log, now)).toMatchObject({ status: "failed" });
    }
    const [run] = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.sourceId, id))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    expect(run.errorMessage).toBe("The calendar link no longer works. Copy a fresh link from the site.");
    expect(lines.filter((l) => l.includes('"alert":"sync_failed_repeatedly"'))).toHaveLength(1);

    serveStatus = 200;
    await syncSource(db, id, "scheduled", log, now);
    const [s] = await db.select().from(sources).where(eq(sources.id, id));
    expect(s.consecutiveFailures).toBe(0);
    expect(s.lastSuccessAt).not.toBeNull();
  });
});
