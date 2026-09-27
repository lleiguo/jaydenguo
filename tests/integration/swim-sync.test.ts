import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  events,
  sources,
  swimEntries,
  swimMeets,
  swimResultRevisions,
  swimResults,
  syncRuns,
} from "@db/schema";
import { createCredential } from "@/server/credentials/store";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createLogger, forgetSecrets } from "@/server/log";
import { syncSource } from "@/worker/sync";
import { createFakeCommit, FAKE_COMMIT_LOGIN, OTHER_FAMILY_NAME } from "../e2e/support/fake-commit";

// Plan M2.3: the Commit Swimming adapter end to end, through real Chromium
// against a fake of the site, into Postgres.

describe("Commit Swimming sync", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  const servers: Server[] = [];
  const lines: string[] = [];
  const log = createLogger((l) => lines.push(l));
  // The fixture's dates are in 2022-2024.
  const now = () => new Date("2024-09-29T12:00:00Z");

  async function fakeSite(opts: Parameters<typeof createFakeCommit>[0] = {}) {
    const server = createFakeCommit({ now, ...opts });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    process.env.COMMIT_SWIM_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function newSource(password = FAKE_COMMIT_LOGIN.password) {
    const cred = await createCredential(db, "test", {
      kind: "password",
      provider: "commit_swim",
      label: "Commit",
      username: FAKE_COMMIT_LOGIN.username,
      secret: password,
    });
    const [s] = await db
      .insert(sources)
      .values({
        kind: "commit_swim",
        name: "Swimming",
        credentialId: cred.id,
        categoryMapping: { default: "swimming" },
      })
      .returning();
    return s.id;
  }

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    process.env.SYNC_MIN_GAP_MINUTES = "0";
  });
  afterAll(async () => {
    for (const s of servers) s.close();
    delete process.env.COMMIT_SWIM_BASE_URL;
    delete process.env.SYNC_MIN_GAP_MINUTES;
    await handle.close();
  });
  beforeEach(() => {
    lines.length = 0;
    forgetSecrets();
  });

  it("signs in, reads meets, entries and results, and puts meets on the calendar", async () => {
    await fakeSite();
    const id = await newSource();
    const result = await syncSource(db, id, "manual", log, now);
    expect(result).toEqual({ status: "succeeded", added: 20 + 14 + 33, changed: 0, cancelled: 0 });

    const meets = await db.select().from(swimMeets).where(eq(swimMeets.sourceId, id));
    expect(meets).toHaveLength(14);
    const results = await db.select().from(swimResults).where(eq(swimResults.sourceId, id));
    expect(results).toHaveLength(33);
    expect(results.every((r) => r.origin === "source" && r.sourceValues !== null)).toBe(true);
    const entered = meets.find((m) => m.externalId === "signup:su009")!;
    expect(await db.select().from(swimEntries).where(eq(swimEntries.meetId, entered.id))).toHaveLength(3);
    const calendar = await db.select().from(events).where(eq(events.sourceId, id));
    expect(calendar).toHaveLength(20);
    expect(calendar.every((e) => e.category === "swimming" && e.allDay)).toBe(true);

    // Only our swimmer's data, and no secret in the log (CRED-5).
    const everything = JSON.stringify({ meets, results, calendar });
    expect(everything).not.toContain(OTHER_FAMILY_NAME);
    expect(results.some((r) => r.distance === 400)).toBe(false);
    expect(lines.join("\n")).not.toContain(FAKE_COMMIT_LOGIN.password);

    // A second run changes nothing (SYNC-3).
    expect(await syncSource(db, id, "manual", log, now)).toEqual({
      status: "succeeded",
      added: 0,
      changed: 0,
      cancelled: 0,
    });
  }, 60_000);

  it("keeps the owner's correction through the next sync and flags the disagreement (SWM-7)", async () => {
    await fakeSite();
    const id = await newSource();
    await syncSource(db, id, "manual", log, now);
    const [row] = await db
      .select()
      .from(swimResults)
      .where(and(eq(swimResults.sourceId, id), eq(swimResults.externalId, "sw040")));
    await db
      .update(swimResults)
      .set({ timeMs: 270000, correctedAt: sql`now()`, correctedBy: "owner@example.test" })
      .where(eq(swimResults.id, row.id));

    await syncSource(db, id, "manual", log, now);
    const [after] = await db.select().from(swimResults).where(eq(swimResults.id, row.id));
    expect(after.timeMs).toBe(270000);
    expect(after.sourceDisagrees).toBe(true);
    expect((after.sourceValues as { timeMs: number }).timeMs).toBe(271350);
    const revisions = await db
      .select()
      .from(swimResultRevisions)
      .where(eq(swimResultRevisions.resultId, row.id));
    expect(revisions.map((r) => r.action)).toEqual(["insert", "source_disagrees"]);
  }, 60_000);

  it("says plainly when the login is wrong or needs a code (SYNC-4)", async () => {
    await fakeSite();
    const id = await newSource("wrong-password");
    expect(await syncSource(db, id, "manual", log, now)).toEqual({
      status: "failed",
      error: "Login failed: check your Commit Swimming email and password.",
    });
    expect(lines.join("\n")).not.toContain("wrong-password");

    await fakeSite({ requireCode: true });
    const id2 = await newSource();
    const outcome = await syncSource(db, id2, "manual", log, now);
    expect(outcome).toEqual({
      status: "failed",
      error: "Commit Swimming asks for a sign-in code, so automatic sync can't sign in.",
    });
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.sourceId, id2));
    expect(run.status).toBe("failed");
  }, 60_000);
});
