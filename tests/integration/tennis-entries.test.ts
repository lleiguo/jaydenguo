import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sources, tennisEntries, tennisTournaments } from "@db/schema";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createLogger } from "@/server/log";
import {
  manualRegistrar,
  runAcceptance,
  runDrawWatch,
  runEnter,
  runRefresh,
  type EntryContext,
  type Registrar,
} from "@/server/tennis/entries";
import { syncSource } from "@/worker/sync";
import { createFakeTc, ENTRY_FIXTURE, TC_FIXTURE, TC_NOW, TC_PROFILE_URL } from "../e2e/support/fake-tc";

// TEN-9..11: the Thursday, Friday and draw-day jobs against a fake of the
// tournament site, into Postgres.

describe("tennis tournament entries", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let base: string;
  const requests: string[] = [];
  // Tests set his row on tournament A's entry list here.
  let selfRow = "";
  // And when online entry opens for tournament A ("" = no date shown).
  let opensA = "";
  const log = createLogger((l) => process.env.DEBUG_LOG && console.log(l));
  const ctx = (): EntryContext => ({ db, log, now: TC_NOW, timeZone: "America/Toronto" });
  const drive = async (_from: string, to: string) => (to.includes("Faraway") ? 100 : 30);

  async function newSource() {
    const [s] = await db
      .insert(sources)
      .values({
        kind: "tennis_tc",
        name: "Tennis",
        config: { profileUrl: TC_PROFILE_URL(base), entry: { homePostalCode: "A1A 1A1" } },
        categoryMapping: { default: "tennis" },
      })
      .returning();
    // His name comes from the first sync. The sync also refreshes entries
    // (tested on its own below); the job tests start without them.
    expect((await syncSource(db, s.id, "manual", log, () => TC_NOW)).status).toBe("succeeded");
    await db.delete(tennisEntries).where(eq(tennisEntries.sourceId, s.id));
    return s;
  }
  const entriesOf = (sourceId: string) =>
    db
      .select()
      .from(tennisEntries)
      .where(eq(tennisEntries.sourceId, sourceId))
      .orderBy(tennisEntries.tournamentName);

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    process.env.SYNC_MIN_GAP_MINUTES = "0";
    process.env.FETCH_MIN_GAP_MS = "0";
    server = createFakeTc({
      requests,
      edit: (file, html) =>
        file === "entries/event-a6.html"
          ? html.replace("<!--SELF-->", selfRow)
          : file === "entries/tournament-a.html" && opensA
            ? html.replace(
                '<ul class="list">',
                `<ul class="list"><li class="list__item"><span class="list__value">Entry opens</span><time datetime="${opensA}T08:00:00">${opensA}</time></li>`,
              )
            : html,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.TENNIS_TC_BASE_URL = base;
  });
  afterAll(async () => {
    server.close();
    delete process.env.TENNIS_TC_BASE_URL;
    delete process.env.SYNC_MIN_GAP_MINUTES;
    delete process.env.FETCH_MIN_GAP_MS;
    await handle.close();
  });

  it("Thursday: finds his event near home, one per weekend, and leaves entering to the owner", async () => {
    selfRow = "";
    const s = await newSource();
    const result = await runEnter(ctx(), s, { drive, registrar: manualRegistrar });
    expect(result).toEqual({ listed: 0, found: 2, entered: 0, left: 1, skipped: 1 });
    const rows = await entriesOf(s.id);
    expect(rows.map((r) => [r.tournamentExternalId, r.eventName, r.status, r.driveMinutes])).toEqual([
      [ENTRY_FIXTURE.b, "U10 Orange", "skipped", 100],
      [ENTRY_FIXTURE.a, "U9 Orange Boys", "found", 30],
    ]);
    const a = rows.find((r) => r.tournamentExternalId === ENTRY_FIXTURE.a)!;
    expect(a).toMatchObject({
      startDate: "2024-10-05",
      endDate: "2024-10-06",
      entryDeadline: "2024-10-01",
      city: "Nearby",
      entryUrl: `${base}/individual-entry/${ENTRY_FIXTURE.a}`,
    });
    expect(rows[0].note).toMatch(/Same dates as Fixture Rookie Open/);

    // A second run adds nothing: known tournaments are skipped.
    expect(await runEnter(ctx(), s, { drive, registrar: manualRegistrar })).toMatchObject({ found: 0 });
    expect(await entriesOf(s.id)).toHaveLength(2);
  });

  it("every refresh: keeps a matching tournament not open yet, and skipped ones with why; Thursday enters it once open", async () => {
    selfRow = "";
    opensA = "2024-10-03";
    try {
      const s = await newSource();
      expect(await runRefresh(ctx(), s, { drive })).toMatchObject({ notOpen: 1, skipped: 1 });
      const rows = await entriesOf(s.id);
      const a = rows.find((r) => r.tournamentExternalId === ENTRY_FIXTURE.a);
      expect(a).toMatchObject({ status: "not_open", entryOpens: "2024-10-03", eventName: "U9 Orange Boys" });
      const c = rows.find((r) => r.tournamentExternalId === ENTRY_FIXTURE.c);
      expect(c).toMatchObject({ status: "skipped", eventName: "" });
      expect(c!.note).toMatch(/^No event for him: /);
      // B is open now: left to the Thursday job.
      expect(rows.some((r) => r.tournamentExternalId === ENTRY_FIXTURE.b)).toBe(false);
      // A second refresh reads nothing it already knows.
      expect(await runRefresh(ctx(), s, { drive })).toMatchObject({ notOpen: 0, skipped: 0 });

      // Entry opened: Thursday picks it up.
      opensA = "";
      await runEnter(ctx(), s, { drive, registrar: manualRegistrar });
      const [after] = (await entriesOf(s.id)).filter((r) => r.tournamentExternalId === ENTRY_FIXTURE.a);
      expect(after.status).not.toBe("not_open");
    } finally {
      opensA = "";
    }
  });

  it("Thursday: records an entry the registrar made, and drops tournaments beyond the drive limit", async () => {
    selfRow = "";
    const s = await newSource();
    const paying: Registrar = { enter: async () => ({ result: "payment_needed" }) };
    const farOnly = async (_f: string, to: string) => (to.includes("Faraway") ? 150 : 30);
    expect(await runEnter(ctx(), s, { drive: farOnly, registrar: paying })).toEqual({
      listed: 0,
      found: 1,
      entered: 1,
      left: 0,
      skipped: 0,
    });
    const [a] = await entriesOf(s.id);
    expect(a).toMatchObject({ tournamentExternalId: ENTRY_FIXTURE.a, status: "payment_needed" });
    expect(a.enteredAt).not.toBeNull();
  });

  it("Thursday: sees an entry the owner already made by hand", async () => {
    selfRow = `<tr><td class="green elt1">Maindraw</td><td><a href="player.aspx?id=${ENTRY_FIXTURE.a}&amp;player=77">Sam Fixture</a></td><td></td></tr>`;
    const s = await newSource();
    await runEnter(ctx(), s, { drive, registrar: manualRegistrar });
    const rows = await entriesOf(s.id);
    // A is his already, so B (same dates) isn't entered either.
    expect(rows.map((r) => [r.tournamentExternalId, r.status, r.tournamentPlayerId])).toEqual([
      [ENTRY_FIXTURE.b, "skipped", null],
      [ENTRY_FIXTURE.a, "main_draw", "77"],
    ]);
  });

  it("Friday: reads main draw or reserve list and place", async () => {
    selfRow = "";
    const s = await newSource();
    await runEnter(ctx(), s, { drive, registrar: manualRegistrar });
    selfRow = `<tr><td class="orange elt9998">Reserve list 2</td><td><a href="player.aspx?id=${ENTRY_FIXTURE.a}&amp;player=77">Fixture, Sam</a></td><td></td></tr>`;
    await runAcceptance(ctx(), s);
    const [a] = (await entriesOf(s.id)).filter((r) => r.tournamentExternalId === ENTRY_FIXTURE.a);
    expect(a).toMatchObject({ status: "reserve", reservePosition: 2, tournamentPlayerId: "77" });
    expect(a.listCheckedAt).not.toBeNull();

    selfRow = selfRow.replace(`class="orange elt9998">Reserve list 2`, `class="green elt1">Maindraw`);
    await runAcceptance(ctx(), s);
    const [again] = (await entriesOf(s.id)).filter((r) => r.tournamentExternalId === ENTRY_FIXTURE.a);
    expect(again).toMatchObject({ status: "main_draw", reservePosition: null });

    selfRow = "";
    await runAcceptance(ctx(), s);
    const [gone] = (await entriesOf(s.id)).filter((r) => r.tournamentExternalId === ENTRY_FIXTURE.a);
    expect(gone.status).toBe("withdrawn");
  });

  it("finds a tournament he's on the entry list for that the app never entered him in", async () => {
    // Entered by hand, e.g. before these jobs ran; entry may be closed now.
    selfRow = `<tr><td class="green elt1">Maindraw</td><td><a href="player.aspx?id=${ENTRY_FIXTURE.a}&amp;player=77">Sam Fixture</a></td><td></td></tr>`;
    const s = await newSource();
    expect(await runAcceptance(ctx(), s)).toMatchObject({ listed: 1 });
    const rows = await entriesOf(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tournamentExternalId: ENTRY_FIXTURE.a,
      eventNo: "6",
      eventName: "U9 Orange Boys",
      status: "main_draw",
      tournamentPlayerId: "77",
      startDate: "2024-10-05",
      endDate: "2024-10-06",
      city: "Nearby",
    });
    // Once it's followed, the list check owns it: no second row.
    await runAcceptance(ctx(), s);
    expect(await entriesOf(s.id)).toHaveLength(1);
  });

  it("the sync reads tournaments he's entered before his profile shows them", async () => {
    selfRow = "";
    const s = await newSource();
    await db.insert(tennisEntries).values({
      sourceId: s.id,
      tournamentExternalId: ENTRY_FIXTURE.a,
      tournamentName: "Fixture Rookie Open",
      startDate: "2024-10-05",
      endDate: "2024-10-06",
      eventNo: "6",
      eventName: "U9 Orange Boys",
      status: "entered",
      tournamentUrl: `${base}/tournament/${ENTRY_FIXTURE.a}`,
    });
    expect((await syncSource(db, s.id, "manual", log, () => TC_NOW)).status).toBe("succeeded");
    const [t] = await db
      .select()
      .from(tennisTournaments)
      .where(and(eq(tennisTournaments.sourceId, s.id), eq(tennisTournaments.externalId, ENTRY_FIXTURE.a)));
    expect(t).toMatchObject({
      entered: true,
      startDate: "2024-10-05",
      endDate: "2024-10-06",
      city: "Nearby",
    });
  });

  it("draw days: once his draw is out, runs the full sync, then stops watching", async () => {
    const s = await newSource();
    await db.insert(tennisEntries).values({
      sourceId: s.id,
      tournamentExternalId: TC_FIXTURE.currentTournament,
      tournamentName: "Current",
      startDate: "2024-09-26",
      endDate: "2024-09-29",
      eventNo: "13",
      eventName: "Fixture Event 13",
      status: "main_draw",
      tournamentUrl: `${base}/tournament/${TC_FIXTURE.currentTournament}`,
    });
    const synced: string[] = [];
    const sync = async (id: string) => {
      synced.push(id);
      return (await syncSource(db, id, "scheduled", log, () => TC_NOW)).status;
    };
    expect(await runDrawWatch(ctx(), s, sync)).toEqual({ watching: 1, seen: 1, sync: "ran" });
    expect(synced).toEqual([s.id]);
    const [e] = await entriesOf(s.id);
    expect(e.tournamentPlayerId).toBe(ENTRY_FIXTURE.selfCurrentTp);
    expect(e.drawSeenAt).not.toBeNull();
    expect(e.drawSyncedAt).not.toBeNull();

    // Nothing left to watch: no requests at all.
    requests.length = 0;
    expect(await runDrawWatch(ctx(), s, sync)).toEqual({ watching: 0, seen: 0, sync: "not needed" });
    expect(requests).toEqual([]);
  });

  it("draw days: keeps watching while the draw isn't out", async () => {
    selfRow = `<tr><td class="green elt1">Maindraw</td><td><a href="player.aspx?id=${ENTRY_FIXTURE.a}&amp;player=77">Sam Fixture</a></td><td></td></tr>`;
    const s = await newSource();
    await db.insert(tennisEntries).values({
      sourceId: s.id,
      tournamentExternalId: ENTRY_FIXTURE.a,
      tournamentName: "Fixture Rookie Open",
      startDate: "2024-10-05",
      endDate: "2024-10-06",
      eventNo: "6",
      eventName: "U9 Orange Boys",
      status: "main_draw",
      tournamentUrl: `${base}/tournament/${ENTRY_FIXTURE.a}`,
    });
    let calls = 0;
    const result = await runDrawWatch(ctx(), s, async () => {
      calls++;
      return "succeeded";
    });
    expect(result).toEqual({ watching: 1, seen: 0, sync: "not needed" });
    expect(calls).toBe(0);
    const [e] = await entriesOf(s.id);
    expect(e).toMatchObject({ drawSeenAt: null, drawSyncedAt: null, tournamentPlayerId: "77" });
  });
});
