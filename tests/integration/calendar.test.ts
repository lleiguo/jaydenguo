import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { events, sources } from "@db/schema";
import type { SourceRecord } from "@/domain/upsert";
import { currentCursor, loadCalendar, loadDeleted } from "@/server/calendar/load";
import {
  acceptClash,
  createEvent,
  createSeries,
  deleteEvent,
  moveEvent,
  resetEvent,
  restoreEvent,
  setAttendance,
  setOwners,
  skipEvent,
  skipRepeats,
  undoAcceptClash,
  undoOverride,
  undoOverrides,
} from "@/server/calendar/mutations";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { addPerson, listPeople, removePerson } from "@/server/people";
import { syncRecords } from "@/server/sync/apply";

const actor = "owner@example.test";
// Far in the future so other tests' data doesn't interfere.
const day = (d: number, h: number) => new Date(Date.UTC(2031, 2, d, h));

describe("calendar service", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let sourceId: string;
  const game0: SourceRecord = {
    externalId: "game",
    category: "soccer",
    title: "Game",
    notes: null,
    locationName: null,
    startUtc: day(3, 22),
    endUtc: day(3, 23),
    allDay: false,
    attendance: "required",
    sourceUrl: null,
  };
  const window = { from: null, to: null };

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    // The test database is ours: start this file from empty calendar tables.
    await db.execute(
      sql`truncate conflicts, event_overrides, event_revisions, events, event_series, change_log restart identity cascade`,
    );
    await db.execute(sql`delete from people where not is_primary`);
    [{ id: sourceId }] = await db.insert(sources).values({ kind: "ical", name: "Soccer" }).returning();
    await syncRecords(db, { sourceId }, [game0], window, { actor: "sync" });
  });
  afterAll(() => handle.close());

  const cal = () => loadCalendar(db, day(1, 0), day(10, 0));
  const personId = async (name: string) =>
    (await listPeople(db)).find((p) => p.name === name)?.id ?? (await addPerson(db, name));
  const gameId = async () => (await db.select().from(events).where(eq(events.sourceId, sourceId)))[0].id;

  it("detects a clash, and moving the event clears it; the move survives the next sync (CON-3, CON-5)", async () => {
    const lessonId = await createEvent(db, actor, {
      title: "Tennis lesson",
      category: "tennis",
      attendance: "required",
      start: day(3, 22),
      end: day(3, 23),
      allDay: false,
      notes: null,
      locationName: null,
    });
    const before = await cal();
    const id = await gameId();
    expect(before.clashes.filter((c) => [c.a, c.b].includes(id))).toHaveLength(1);

    const undo = await moveEvent(db, actor, id, { start: day(4, 22), end: day(4, 23) });
    const after = await cal();
    expect(after.clashes.filter((c) => [c.a, c.b].includes(id))).toHaveLength(0);
    expect(after.cursor).toBeGreaterThan(before.cursor);

    // The source moves the game by 30 minutes: the owner's move stays, flagged.
    await syncRecords(db, { sourceId }, [{ ...game0, startUtc: day(3, 21), endUtc: day(3, 22) }], window, {
      actor: "sync",
    });
    const moved = (await cal()).events.find((e) => e.id === id)!;
    expect(moved.start).toBe(day(4, 22).toISOString());
    expect(moved.override?.sourceChangedAt).not.toBeNull();
    expect(moved.override?.originalStart).toBe(day(3, 21).toISOString());

    // Undo puts it back where the source has it.
    await undoOverride(db, actor, undo.url.split("/")[4]);
    const back = (await cal()).events.find((e) => e.id === id)!;
    expect(back.start).toBe(day(3, 21).toISOString());
    await deleteEvent(db, actor, lessonId);
  });

  it("skip and accept clash clear the highlight and can be undone (CON-4)", async () => {
    const id = await gameId();
    const other = await createEvent(db, actor, {
      title: "Swim",
      category: "swimming",
      attendance: "required",
      start: day(3, 21),
      end: day(3, 22),
      allDay: false,
      notes: null,
      locationName: null,
    });
    const clashesWith = async () =>
      (await cal()).clashes.filter(
        (c) => [c.a, c.b].includes(id) && [c.a, c.b].includes(other) && !c.acceptedId,
      );
    expect(await clashesWith()).toHaveLength(1);

    const skipUndo = await skipEvent(db, actor, other, true);
    expect(await clashesWith()).toHaveLength(0);
    await undoOverride(db, actor, skipUndo.url.split("/")[4]);
    expect(await clashesWith()).toHaveLength(1);

    const acceptUndo = await acceptClash(db, actor, other, id);
    expect(await clashesWith()).toHaveLength(0);
    await undoAcceptClash(db, actor, acceptUndo.url.split("/")[4]);
    expect(await clashesWith()).toHaveLength(1);
    await deleteEvent(db, actor, other);
  });

  it("a parent's own event doesn't clash with his; the choice survives syncs and moves (CON-1)", async () => {
    const id = await gameId();
    const parent = await personId("Parent");
    const cls = await createEvent(db, actor, {
      title: "Class",
      category: "school_class",
      attendance: "required",
      start: day(3, 21),
      end: day(3, 22),
      allDay: false,
      notes: null,
      locationName: null,
    });
    const clashes = async () =>
      (await cal()).clashes.filter((c) => [c.a, c.b].includes(id) && [c.a, c.b].includes(cls));
    expect(await clashes()).toMatchObject([{ people: [await personId("Jayden")] }]);

    // The synced event is someone else's: an override, kept by the next sync.
    const undo = await setOwners(db, actor, id, [parent]);
    expect(await clashes()).toHaveLength(0);
    await syncRecords(db, { sourceId }, [{ ...game0, startUtc: day(3, 21), endUtc: day(3, 22) }], window, {
      actor: "sync",
    });
    const view = (await cal()).events.find((e) => e.id === id)!;
    expect(view).toMatchObject({ owners: [parent], override: { owners: [parent] } });

    // "Use the source's time" after a move keeps whose event it is.
    await moveEvent(db, actor, id, { start: day(4, 21), end: day(4, 22) });
    await resetEvent(db, actor, id);
    expect((await cal()).events.find((e) => e.id === id)).toMatchObject({
      start: day(3, 21).toISOString(),
      owners: [parent],
    });
    expect(await clashes()).toHaveLength(0);
    // Both of theirs: it clashes again, for him.
    const both = await setOwners(db, actor, id, [await personId("Jayden"), parent]);
    expect(await clashes()).toHaveLength(1);
    // Undo steps back to the parent's alone.
    await undoOverride(db, actor, both.url.split("/")[4]);
    expect(await clashes()).toHaveLength(0);
    expect(undo.url).toMatch(/^\/api\/v1\/overrides\//);
    // Giving it back to what the source says drops the owners override.
    await setOwners(db, actor, id, []);
    expect((await cal()).events.find((e) => e.id === id)?.override?.owners).toBeNull();

    // An event added here changes directly, and undo sets it back.
    const manualUndo = await setOwners(db, actor, cls, [parent]);
    const [row] = await db.select().from(events).where(eq(events.id, cls));
    expect(row.ownerIds).toEqual([parent]);
    expect(await clashes()).toHaveLength(0);
    expect(manualUndo).toEqual({
      method: "POST",
      url: `/api/v1/events/${cls}/owners`,
      body: { ownerIds: [] },
    });

    // Optional events never clash either.
    await setOwners(db, actor, cls, []);
    expect(await clashes()).toHaveLength(1);
    await setAttendance(db, actor, cls, "optional");
    expect(await clashes()).toHaveLength(0);
    await deleteEvent(db, actor, cls);
  });

  it("removing a person gives their events back to the primary person", async () => {
    const aunt = await addPerson(db, "Aunt");
    await expect(addPerson(db, "aunt")).rejects.toThrow(/already/);
    const id = await createEvent(db, actor, {
      title: "Aunt's visit",
      category: "other",
      attendance: "required",
      ownerIds: [aunt],
      start: day(6, 15),
      end: day(6, 16),
      allDay: false,
      notes: null,
      locationName: null,
    });
    await removePerson(db, aunt);
    const view = (await cal()).events.find((e) => e.id === id)!;
    expect(view.owners).toEqual([await personId("Jayden")]);
    const [primary] = (await listPeople(db)).filter((p) => p.isPrimary);
    await expect(removePerson(db, primary.id)).rejects.toThrow(/can't be removed/);
    await deleteEvent(db, actor, id);
  });

  it("deletes softly and restores (CAL-6)", async () => {
    const id = await createEvent(db, actor, {
      title: "Dentist",
      category: "other",
      attendance: "required",
      start: day(5, 15),
      end: day(5, 16),
      allDay: false,
      notes: null,
      locationName: null,
    });
    await deleteEvent(db, actor, id);
    expect((await cal()).events.find((e) => e.id === id)).toBeUndefined();
    expect((await loadDeleted(db)).find((e) => e.id === id)).toBeDefined();
    await restoreEvent(db, actor, id);
    expect((await cal()).events.find((e) => e.id === id)).toBeDefined();
    await expect(deleteEvent(db, actor, await gameId())).rejects.toThrow(/skipped, not deleted/);
  });

  it("shows a household copy of a source's game once, as the source's", async () => {
    const [{ id: householdId }] = await db
      .insert(sources)
      .values({ kind: "google_calendar", name: "Household" })
      .returning();
    const game = (await cal()).events.find((e) => e.title === "Game")!;
    await syncRecords(
      db,
      { sourceId: householdId },
      [
        {
          ...game0,
          externalId: "h-soccer",
          title: "Jayden soccer",
          startUtc: new Date(game.start),
          endUtc: new Date(game.end),
        },
        {
          ...game0,
          externalId: "h-math",
          title: "Math",
          category: "math",
          startUtc: new Date(game.start),
          endUtc: new Date(game.end),
        },
      ],
      window,
      { actor: "sync" },
    );
    const got = await cal();
    const titles = got.events.map((e) => e.title);
    expect(titles).toContain("Game");
    expect(titles).not.toContain("Jayden soccer");
    // The household math at the same time is a different event: it shows, and clashes.
    const math = got.events.find((e) => e.title === "Math")!;
    expect(got.clashes.filter((c) => [c.a, c.b].includes(math.id))).toHaveLength(1);
    await syncRecords(db, { sourceId: householdId }, [], window, { actor: "sync" });
  });

  it("writes out repeating events (CAL-5)", async () => {
    const cursor = await currentCursor(db);
    await createSeries(db, actor, {
      title: "Math",
      category: "math",
      attendance: "required",
      notes: null,
      locationName: null,
      allDay: false,
      startDate: "2027-03-01",
      untilDate: "2027-03-31",
      startTime: "17:00",
      durationMin: 60,
      intervalWeeks: 1,
      weekdays: [1, 3],
      timeZone: "America/Toronto",
    });
    const range = await loadCalendar(db, new Date("2027-03-01T00:00:00Z"), new Date("2027-03-08T00:00:00Z"));
    const maths = range.events.filter((e) => e.title === "Math");
    // Mondays and Wednesdays in the first week of March 2027.
    expect(maths.map((e) => e.start.slice(0, 10))).toEqual(["2027-03-01", "2027-03-03"]);
    expect(await currentCursor(db)).toBeGreaterThan(cursor);
  });

  it("skips every upcoming repeat of a feed's event, and undoes them together (CON-4)", async () => {
    const [{ id: feedId }] = await db.insert(sources).values({ kind: "ical", name: "Gym" }).returning();
    const at = (d: number, uid: string): SourceRecord => ({
      ...game0,
      externalId: `${uid}#2031040${d}T150000`,
      title: uid,
      startUtc: new Date(Date.UTC(2031, 3, d, 19)),
      endUtc: new Date(Date.UTC(2031, 3, d, 20)),
    });
    await syncRecords(
      db,
      { sourceId: feedId },
      [
        at(1, "fitness"),
        at(3, "fitness"),
        at(5, "fitness"),
        at(3, "other"),
        { ...game0, externalId: "once" },
      ],
      window,
      { actor: "sync" },
    );
    const april = () => loadCalendar(db, new Date("2031-04-01T00:00:00Z"), new Date("2031-04-08T00:00:00Z"));
    const fitness = async () => (await april()).events.filter((e) => e.title === "fitness");
    expect((await fitness()).every((e) => e.repeats)).toBe(true);
    const [first, second] = await fitness();
    await skipEvent(db, actor, second.id, true);

    const { undo, count } = await skipRepeats(db, actor, first.id, true);
    // The one skipped already isn't counted again.
    expect(count).toBe(2);
    expect((await fitness()).map((e) => e.override?.skip)).toEqual([true, true, true]);
    expect((await april()).events.find((e) => e.title === "other")?.override).toBeNull();

    await undoOverrides(db, actor, (undo.body as { ids: string[] }).ids);
    expect((await fitness()).map((e) => !!e.override?.skip)).toEqual([false, true, false]);

    const once = (await db.select().from(events).where(eq(events.externalId, "once")))[0];
    await expect(skipRepeats(db, actor, once.id, true)).rejects.toThrow("doesn't repeat");
  });
});
