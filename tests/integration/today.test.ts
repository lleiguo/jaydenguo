import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sources, syncRuns, tennisEntries } from "@db/schema";
import type { Category } from "@/domain/constants";
import { createEvent } from "@/server/calendar/mutations";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { tennisOverview } from "@/server/tennis/overview";
import { loadToday } from "@/server/today";

// intent 0004, APP-2 and API-3: the Today screen's one call, and the Tennis
// overview the app reads from /api/v1/tennis/tournaments.

const actor = "owner@example.test";
// Far in the future so other tests' data doesn't interfere; 19:00 UTC is the
// same local date in every North American time zone.
const now = new Date("2031-05-14T19:00:00Z");
const at = (iso: string) => new Date(iso);

describe("Today", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let failingId: string;
  let tennisSourceId: string;

  const add = (title: string, start: string, end: string, category: Category = "soccer") =>
    createEvent(db, actor, {
      title,
      category,
      attendance: "required",
      start: at(start),
      end: at(end),
      allDay: false,
      notes: null,
      locationName: null,
    });

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    await db.execute(
      sql`truncate conflicts, event_overrides, event_revisions, events, event_series, change_log, tennis_entries restart identity cascade`,
    );
    await add("Practice today", "2031-05-14T20:00:00Z", "2031-05-14T21:00:00Z");
    // Tomorrow: overlap by 30 minutes, so a clash (CON-1).
    await add("Game tomorrow", "2031-05-15T20:00:00Z", "2031-05-15T21:00:00Z");
    await add("Lesson tomorrow", "2031-05-15T20:30:00Z", "2031-05-15T21:30:00Z", "tennis");
    // Clashing but more than a week away: not on Today.
    await add("Far A", "2031-05-30T20:00:00Z", "2031-05-30T21:00:00Z");
    await add("Far B", "2031-05-30T20:00:00Z", "2031-05-30T21:00:00Z", "math");

    [{ id: failingId }] = await db
      .insert(sources)
      .values({ kind: "ical", name: "Broken feed", consecutiveFailures: 2 })
      .returning();
    await db.insert(syncRuns).values({ sourceId: failingId, trigger: "scheduled", status: "failed" });
    const [off] = await db
      .insert(sources)
      .values({ kind: "ical", name: "Switched off", enabled: false })
      .returning();
    await db.insert(syncRuns).values({ sourceId: off.id, trigger: "scheduled", status: "failed" });

    [{ id: tennisSourceId }] = await db
      .insert(sources)
      .values({ kind: "tennis_tc", name: "Tennis" })
      .returning();
    const entry = {
      sourceId: tennisSourceId,
      startDate: "2031-06-07",
      endDate: "2031-06-08",
      eventNo: "1",
      eventName: "U9 Orange",
      tournamentUrl: "https://tennis.example/t",
    };
    await db.insert(tennisEntries).values([
      { ...entry, tournamentExternalId: "found-1", tournamentName: "Found Open", status: "found" },
      { ...entry, tournamentExternalId: "paid-1", tournamentName: "Entered Open", status: "entered" },
    ]);
  });
  afterAll(async () => {
    await db.execute(sql`truncate tennis_entries restart identity cascade`);
    await handle.close();
  });

  it("has today's events only, and the week's clashes with both events", async () => {
    const t = await loadToday(db, now);
    expect(t.date).toBe("2031-05-14");
    expect(t.events.map((e) => e.title)).toEqual(["Practice today"]);
    expect(t.clashes).toHaveLength(1);
    expect([t.clashes[0].eventA.title, t.clashes[0].eventB.title].sort()).toEqual([
      "Game tomorrow",
      "Lesson tomorrow",
    ]);
    expect(t.people.some((p) => p.isPrimary)).toBe(true);
    expect(t.cursor).toBeGreaterThan(0);
  });

  it("lists what's waiting on the owner", async () => {
    const t = await loadToday(db, now);
    // Other test files' sources share the database: look for ours only.
    expect(t.waiting.failingSources).toContainEqual({
      id: failingId,
      name: "Broken feed",
      consecutiveFailures: 2,
    });
    expect(t.waiting.failingSources.map((s) => s.name)).not.toContain("Switched off");
    expect(t.waiting.entries.map((e) => e.tournamentName)).toEqual(["Found Open"]);
    expect(t.waiting.suggestions).toBeGreaterThanOrEqual(0);
  });

  it("gives the Tennis overview's found and upcoming rows", async () => {
    const o = await tennisOverview(db);
    expect(o.found.map((e) => e.tournamentName)).toEqual(["Found Open"]);
    const row = o.upcomingRows.find((r) => r.name === "Entered Open");
    expect(row?.status.kind).toBe("registered");
    expect(row?.drawPredictions).toEqual([]);
  });
});
