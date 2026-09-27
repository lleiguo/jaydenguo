import { eq, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventOverrides, eventRevisions, events, sources } from "@db/schema";
import { CATEGORIES } from "@/domain/constants";
import type { SourceRecord } from "@/domain/upsert";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { syncRecords } from "@/server/sync/apply";

// The database applier against real Postgres (plan M1.4): same properties as
// the unit tests, checked on stored rows.

const base = Date.UTC(2026, 9, 1);
const recordArb = (id: string) =>
  fc
    .record({
      category: fc.constantFrom(...CATEGORIES),
      title: fc.constantFrom("Practice", "Game"),
      day: fc.integer({ min: 0, max: 30 }),
    })
    .map((r): SourceRecord => ({
      externalId: id,
      category: r.category,
      title: r.title,
      notes: null,
      locationName: null,
      startUtc: new Date(base + r.day * 86_400_000),
      endUtc: new Date(base + r.day * 86_400_000 + 3_600_000),
      allDay: false,
      attendance: "required",
      sourceUrl: null,
    }));
const feedArb = fc
  .uniqueArray(fc.constantFrom("a", "b", "c", "d", "e", "f"), { maxLength: 6 })
  .chain((ids) => fc.tuple(...ids.map(recordArb)))
  .map((r) => r as SourceRecord[]);

describe("syncRecords", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  const window = { from: null, to: null };

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
  });
  afterAll(() => handle.close());

  const newSource = async () =>
    (await db.insert(sources).values({ kind: "ical", name: "test feed" }).returning())[0].id;
  const count = async (sourceId: string) =>
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(events)
        .where(eq(events.sourceId, sourceId))
    )[0].n;

  it("is idempotent, never deletes, and keeps overrides", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(feedArb, { minLength: 1, maxLength: 4 }), async (feeds) => {
        const sourceId = await newSource();
        let size = 0;
        let overrideId: string | null = null;
        for (const feed of feeds) {
          await syncRecords(db, { sourceId }, feed, window, { actor: "sync" });
          const n = await count(sourceId);
          expect(n).toBeGreaterThanOrEqual(size);
          size = n;
          // The owner moves the first event they see.
          if (!overrideId) {
            const [e] = await db.select().from(events).where(eq(events.sourceId, sourceId)).limit(1);
            if (e) {
              [{ id: overrideId }] = await db
                .insert(eventOverrides)
                .values({ eventId: e.id, newStartUtc: e.startUtc, newEndUtc: e.endUtc, createdBy: "owner" })
                .returning({ id: eventOverrides.id });
            }
          }
        }
        const again = await syncRecords(db, { sourceId }, feeds.at(-1)!, window, { actor: "sync" });
        expect(again.items).toEqual([]);
        if (overrideId) {
          const [o] = await db.select().from(eventOverrides).where(eq(eventOverrides.id, overrideId));
          expect(o.clearedAt).toBeNull();
        }
      }),
      { numRuns: 15 },
    );
  });

  it("writes a revision per change and flags overrides when the source moves an event", async () => {
    const sourceId = await newSource();
    const game: SourceRecord = {
      externalId: "g1",
      category: "soccer",
      title: "Game",
      notes: null,
      locationName: "Field 2",
      startUtc: new Date("2026-10-10T17:00:00Z"),
      endUtc: new Date("2026-10-10T18:00:00Z"),
      allDay: false,
      attendance: "required",
      sourceUrl: null,
    };
    await syncRecords(db, { sourceId }, [game], window, { actor: "sync" });
    const [e] = await db.select().from(events).where(eq(events.sourceId, sourceId));
    await db
      .insert(eventOverrides)
      .values({ eventId: e.id, newStartUtc: new Date("2026-10-10T19:00:00Z"), createdBy: "owner" });

    const moved = {
      ...game,
      startUtc: new Date("2026-10-10T16:00:00Z"),
      endUtc: new Date("2026-10-10T17:00:00Z"),
    };
    const plan = await syncRecords(db, { sourceId }, [moved], window, { actor: "sync" });
    expect(plan.counts).toEqual({ added: 0, changed: 1, cancelled: 0 });

    const [o] = await db.select().from(eventOverrides).where(eq(eventOverrides.eventId, e.id));
    expect(o.sourceChangedAt).not.toBeNull();
    expect(o.newStartUtc).toEqual(new Date("2026-10-10T19:00:00Z"));

    await syncRecords(db, { sourceId }, [], window, { actor: "sync" });
    const [after] = await db.select().from(events).where(eq(events.id, e.id));
    expect(after.status).toBe("cancelled");
    const revs = await db.select().from(eventRevisions).where(eq(eventRevisions.eventId, e.id));
    expect(revs.map((r) => r.action).sort()).toEqual(["cancel", "insert", "update"]);
  });
});
