import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sources, tennisChecks } from "@db/schema";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { HttpError } from "@/server/errors";
import { CHECK_GAP_MS, getCheck, lastCheckedAt, requestCheck } from "@/server/tennis/check";

// TPR-1, TPR-4: starting the quick check and following it.

describe("tennis quick check", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  const started: string[][] = [];
  const launcher = { start: async (args: string[]) => void started.push(args) };
  let sourceId = "";

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
  });
  afterAll(async () => {
    await db.delete(tennisChecks);
    if (sourceId) await db.delete(sources).where(eq(sources.id, sourceId));
    await handle.close();
  });
  beforeEach(async () => {
    started.length = 0;
    await db.delete(tennisChecks);
  });

  it("needs a Tennis Canada source", async () => {
    const others = await db.select().from(sources).where(eq(sources.kind, "tennis_tc"));
    if (others.some((s) => s.enabled)) return; // another test's source is around
    await expect(requestCheck(db, launcher)).rejects.toBeInstanceOf(HttpError);
  });

  it("starts one, waits while it runs, answers with it for 5 minutes, then starts again", async () => {
    const [s] = await db
      .insert(sources)
      .values({
        kind: "tennis_tc",
        name: "Tennis (check test)",
        config: {},
        categoryMapping: { default: "tennis" },
      })
      .returning();
    sourceId = s.id;
    const t0 = new Date();
    const first = await requestCheck(db, launcher, t0);
    expect(first).toMatchObject({ started: true, check: { status: "running", recent: false } });
    expect(started).toEqual([["tennis:check", first.check.id]]);

    const again = await requestCheck(db, launcher, new Date(t0.getTime() + 30_000));
    expect(again).toMatchObject({ started: false, check: { id: first.check.id, recent: true } });

    await db
      .update(tennisChecks)
      .set({ status: "succeeded", finishedAt: new Date(t0.getTime() + 20_000), result: { entries: 4 } })
      .where(eq(tennisChecks.id, first.check.id));
    expect(await getCheck(db, first.check.id)).toMatchObject({ status: "succeeded", result: { entries: 4 } });
    expect(await lastCheckedAt(db)).toBe(new Date(t0.getTime() + 20_000).toISOString());
    expect((await requestCheck(db, launcher, new Date(t0.getTime() + 60_000))).started).toBe(false);

    const later = await requestCheck(db, launcher, new Date(t0.getTime() + CHECK_GAP_MS + 1000));
    expect(later.started).toBe(true);
    expect(started).toHaveLength(2);
  });

  it("an unknown check is 404", async () => {
    await expect(getCheck(db, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});
