import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  credentials,
  eventOverrides,
  eventRevisions,
  events,
  householdLinks,
  notifications,
  settings,
  sources,
  syncRuns,
} from "@db/schema";
import { ADD_SCOPE } from "@/domain/assistant-changes";
import { HOUSEHOLD_RULES } from "@/domain/categories";
import { GOOGLE_ACTOR } from "@/domain/constants";
import type { Person } from "@/domain/people";
import { deleteEvent, moveEvent, skipEvent, updateEvent } from "@/server/calendar/mutations";
import { aadFor } from "@/server/credentials/aad";
import { seal } from "@/server/crypto/envelope";
import { defaultKeyWrapper } from "@/server/crypto/key-wrapper";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { applyHeld, getHouseholdSync, nudgeHouseholdSync, setHouseholdSync } from "@/server/household-sync";
import type { JobLauncher } from "@/server/jobs/launcher";
import { createLogger } from "@/server/log";
import { listPeople } from "@/server/people";
import { syncRecords } from "@/server/sync/apply";
import { runHouseholdSync, scheduledHouseholdSource } from "@/worker/household-sync";
import { syncJob, syncSource } from "@/worker/sync";

// Intent 0020, H2: the hub writes its events into the household calendar
// (TWO), against a fake Google Calendar that records every request. The
// household read and the write take turns without ever making a second
// copy (DUP2-1), a lost answer is found again (DUP2-3), the family's own
// events are fenced (TWSEC-1) and big runs are held (TWSEC-2). H3: changes
// made in Google come back (BACK-3..5), and household events changed in
// the hub go to Google (TWO-4). H4: the schedule reads it only while on
// (BACK-1).

type GEvent = Record<string, unknown> & {
  id: string;
  extendedProperties?: { private?: Record<string, string> };
};
type Req = { method: string; path: string; query: string };

describe("two-way sync with the household calendar", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let base = "";
  const requests: Req[] = [];
  const HOUSEHOLD = `household-${randomUUID()}@group.calendar.google.com`;
  const google = new Map<string, GEvent>();
  // Far enough ahead that only this test's events are in the window.
  const now = new Date("2041-03-01T12:00:00Z");
  const at = (day: number, h: number) => new Date(Date.UTC(2041, 2, day, h));
  const started: string[][] = [];
  const launcher: JobLauncher = { start: async (a) => void started.push(a) };
  const log = createLogger((l) => process.env.DEBUG_LOG && console.log(l));
  const saved: Record<string, string | undefined> = {};
  const ids: string[] = [];
  let credentialId: string;
  let sourceId: string;
  let people: Person[];
  let primary: Person;
  let swim: string;
  let soccer: string;

  const writes = () => requests.filter((r) => r.method !== "GET");
  const run = () => runHouseholdSync(db, { log, now: () => now });
  const read = () => syncSource(db, sourceId, "manual", log, () => now);
  const tagged = () => [...google.values()].filter((e) => e.extendedProperties?.private?.hubEventId);
  const householdRows = () =>
    db
      .select()
      .from(events)
      .where(and(eq(events.sourceId, sourceId), eq(events.status, "active"), isNull(events.deletedAt)));

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", base);
      let raw = "";
      for await (const c of req) raw += c;
      const send = (status: number, body?: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body === undefined ? "" : JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/openid-configuration")
        return send(200, {
          issuer: base,
          token_endpoint: `${base}/token`,
          authorization_endpoint: `${base}/a`,
        });
      if (url.pathname === "/token")
        return send(200, { access_token: "hh-token", token_type: "Bearer", expires_in: 300 });
      requests.push({ method: req.method!, path: decodeURIComponent(url.pathname), query: url.search });
      if (req.headers.authorization !== "Bearer hh-token") return send(401);
      const parts = url.pathname.split("/").map(decodeURIComponent);
      // /calendar/v3/calendars/{cal}/events[/{id}]
      if (parts[4] !== HOUSEHOLD || parts[5] !== "events") return send(404);
      const body = raw ? (JSON.parse(raw) as GEvent) : null;
      const stamp = () => new Date().toISOString();
      const id = parts[6];
      if (!id && req.method === "GET") {
        const tag = url.searchParams.get("privateExtendedProperty");
        const items = [...google.values()].filter((e) => {
          if (!tag) return true;
          const [k, v] = tag.split("=");
          return e.extendedProperties?.private?.[k] === v;
        });
        return send(200, { items });
      }
      if (!id && req.method === "POST") {
        const e = { ...body!, id: randomUUID().replace(/-/g, ""), status: "confirmed", updated: stamp() };
        google.set(e.id, e);
        return send(200, e);
      }
      const e = id ? google.get(id) : undefined;
      if (!e) return send(404);
      if (req.method === "GET") return send(200, e);
      if (req.method === "DELETE") return (google.delete(id!), send(204));
      if (req.method === "PUT") {
        const next = { ...body!, id: id!, updated: stamp() };
        google.set(id!, next);
        return send(200, next);
      }
      if (req.method === "PATCH") {
        // Google's patch: fields replace, private properties merge.
        const next: GEvent = { ...e, ...body!, id: id!, updated: stamp() };
        if (body?.extendedProperties)
          next.extendedProperties = {
            private: { ...e.extendedProperties?.private, ...body.extendedProperties.private },
          };
        google.set(id!, next);
        return send(200, next);
      }
      send(404);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const k of ["OIDC_ISSUER", "GOOGLE_API_BASE", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])
      saved[k] = process.env[k];
    Object.assign(process.env, {
      OIDC_ISSUER: base,
      GOOGLE_API_BASE: base,
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-secret",
    });

    people = await listPeople(db);
    primary = people.find((p) => p.isPrimary)!;
    credentialId = randomUUID();
    await db.insert(credentials).values({
      id: credentialId,
      kind: "oauth",
      provider: "google",
      label: "Google (household@example.test)",
      username: `household-${credentialId}@example.test`,
      // Not yet allowed to write (TWSEC-3).
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      ...(await seal(defaultKeyWrapper(), `refresh-${credentialId}`, aadFor(credentialId))),
    });
    const [source] = await db
      .insert(sources)
      .values({
        kind: "google_calendar",
        name: `Household ${credentialId}`,
        credentialId,
        config: { calendarId: HOUSEHOLD },
        categoryMapping: { default: "other", rules: HOUSEHOLD_RULES },
        enabled: true,
      })
      .returning();
    sourceId = source.id;

    // The family's own event, which is also on the soccer feed (a twin),
    // and one that is only theirs.
    for (const e of [
      {
        id: "familysoccer",
        summary: `${primary.name} soccer`,
        start: { dateTime: at(5, 22).toISOString() },
        end: { dateTime: at(5, 23).toISOString() },
      },
      {
        id: "familydinner",
        summary: "Dinner at grandma's",
        start: { dateTime: at(6, 23).toISOString() },
        end: { dateTime: at(7, 1).toISOString() },
      },
    ])
      google.set(e.id, { ...e, status: "confirmed", updated: now.toISOString() });

    // The hub's own events: a site event, and feed-like events with no
    // source row (the planner treats any non-household source as a feed;
    // a site event has no source, so "soccer" needs one).
    const [feed] = await db
      .insert(sources)
      .values({ kind: "ical", name: `Soccer ${credentialId}`, config: {}, enabled: false })
      .returning();
    const rows = await db
      .insert(events)
      .values([
        { title: "Swim practice", category: "swimming", startUtc: at(4, 22), endUtc: at(4, 23) },
        {
          title: "Game vs Lions",
          category: "soccer",
          startUtc: at(5, 22),
          endUtc: at(5, 23),
          sourceId: feed.id,
          externalId: `game-${credentialId}`,
        },
      ])
      .returning({ id: events.id, title: events.title });
    ids.push(...rows.map((r) => r.id));
    swim = rows.find((r) => r.title === "Swim practice")!.id;
    soccer = rows.find((r) => r.title === "Game vs Lions")!.id;
    await db.delete(settings).where(eq(settings.key, "household_sync"));
  });

  afterAll(async () => {
    await db.delete(settings).where(eq(settings.key, "household_sync"));
    await db.delete(householdLinks).where(eq(householdLinks.sourceId, sourceId));
    const all = await db.select({ id: events.id }).from(events).where(eq(events.sourceId, sourceId));
    const gone = [...ids, ...all.map((r) => r.id)];
    await db.delete(eventOverrides).where(inArray(eventOverrides.eventId, gone));
    await db.delete(eventRevisions).where(inArray(eventRevisions.eventId, gone));
    await db.delete(events).where(inArray(events.id, gone));
    await db.delete(syncRuns).where(eq(syncRuns.sourceId, sourceId));
    await db.delete(sources).where(eq(sources.credentialId, credentialId));
    await db.delete(sources).where(eq(sources.name, `Soccer ${credentialId}`));
    await db.delete(sources).where(eq(sources.name, `Tennis ${credentialId}`));
    await db.delete(credentials).where(eq(credentials.id, credentialId));
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    await new Promise((r) => server.close(r));
    await handle.close();
  });

  it("does nothing while off", async () => {
    expect(await run()).toEqual({ skipped: "switched off" });
    expect(await nudgeHouseholdSync(db, launcher, now)).toBe(false);
    // BACK-1: the 15-minute schedule reads nothing while off.
    expect(await scheduledHouseholdSource(db)).toBeNull();
    await syncJob(["household", "scheduled"], { log, db: async () => db });
    expect(requests).toEqual([]);
  });

  it("reads the household calendar as today", async () => {
    expect((await read()).status).toBe("succeeded");
    expect((await householdRows()).map((r) => r.title).sort()).toEqual(
      ["Dinner at grandma's", `${primary.name} soccer`].sort(),
    );
  });

  it("dry run lists what would change and writes nothing (TWO-9)", async () => {
    await setHouseholdSync(db, { mode: "dry_run", sourceId }, launcher);
    expect(started.pop()).toEqual(["household:sync"]);
    expect(await scheduledHouseholdSource(db)).toBe(sourceId);
    expect(await run()).toEqual({ dryRun: true });
    const { dryRun } = await getHouseholdSync(db);
    expect(dryRun!.plan.create.map((l) => l.title)).toEqual(["Swim practice"]);
    expect(dryRun!.plan.link.map((l) => l.title)).toEqual(["Game vs Lions"]);
    expect(writes()).toEqual([]);
  });

  it("can't switch on until the Google account may write (TWSEC-3)", async () => {
    await expect(setHouseholdSync(db, { mode: "on", sourceId }, launcher)).rejects.toMatchObject({
      status: 400,
    });
    await db
      .update(credentials)
      .set({ scopes: [ADD_SCOPE] })
      .where(eq(credentials.id, credentialId));
  });

  it("holds the first run after switching on, then applies it (TWSEC-2)", async () => {
    await setHouseholdSync(db, { mode: "on", sourceId }, launcher);
    const held = await run();
    expect(held).toMatchObject({ held: expect.stringContaining("first run") });
    expect(writes()).toEqual([]);
    const [notice] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupKey, `household_held:${now.toISOString().slice(0, 10)}`));
    expect(notice?.title).toMatch(/waiting/);

    await applyHeld(db, launcher);
    expect(await run()).toEqual({
      created: 1,
      updated: 0,
      linked: 1,
      deleted: 0,
      unlinked: 0,
      fromGoogle: 0,
    });
    const swimEvent = tagged().find((e) => e.extendedProperties!.private!.hubEventId === swim)!;
    expect(swimEvent.summary).toBe(`${primary.name} – Swim practice`);
    // The family's soccer entry now follows the feed, with its own title.
    const twin = google.get("familysoccer")!;
    expect(twin.summary).toBe(`${primary.name} soccer`);
    expect(twin.extendedProperties!.private!.hubEventId).toBe(soccer);
    // The family's other event is left alone.
    expect(google.get("familydinner")!.extendedProperties).toBeUndefined();
    expect((await getHouseholdSync(db)).held).toBeNull();
  });

  it("never makes a second copy, however often it reads and writes (DUP2-1)", async () => {
    const before = google.size;
    for (let i = 0; i < 3; i++) {
      requests.length = 0;
      expect((await read()).status).toBe("succeeded");
      expect(await run()).toEqual({
        created: 0,
        updated: 0,
        linked: 0,
        deleted: 0,
        unlinked: 0,
        fromGoogle: 0,
      });
      expect(writes()).toEqual([]);
    }
    expect(google.size).toBe(before);
    // The events it wrote aren't household events in the hub.
    expect((await householdRows()).map((r) => r.title)).toEqual(["Dinner at grandma's"]);
  });

  it("follows a move, and deletes what left the hub", async () => {
    await db
      .insert(eventOverrides)
      .values({ eventId: swim, newStartUtc: at(4, 20), newEndUtc: at(4, 21), createdBy: "owner" });
    requests.length = 0;
    expect(await run()).toMatchObject({ updated: 1, created: 0 });
    expect(writes().map((r) => r.method)).toEqual(["PATCH"]);
    const swimEvent = tagged().find((e) => e.extendedProperties!.private!.hubEventId === swim)!;
    expect(swimEvent.start).toMatchObject({ dateTime: at(4, 20).toISOString() });

    await db.update(events).set({ deletedAt: now }).where(eq(events.id, swim));
    requests.length = 0;
    expect(await run()).toMatchObject({ deleted: 1 });
    expect(google.has(swimEvent.id)).toBe(false);
  });

  it("unlinks the family's event when the feed drops it, without deleting it", async () => {
    await db.update(events).set({ status: "cancelled" }).where(eq(events.id, soccer));
    expect(await run()).toMatchObject({ unlinked: 1, deleted: 0 });
    expect(google.get("familysoccer")!.extendedProperties?.private?.hubEventId).toBeUndefined();
    await db.update(events).set({ status: "active" }).where(eq(events.id, soccer));
    await read();
    // Back on the feed: matched again, not doubled.
    expect(await run()).toMatchObject({ linked: 1, created: 0 });
  });

  it("finds an event a lost answer already added, instead of adding it twice (DUP2-3)", async () => {
    const [lost] = await db
      .insert(events)
      .values({ title: "Math class", category: "math", startUtc: at(8, 22), endUtc: at(8, 23) })
      .returning({ id: events.id });
    ids.push(lost.id);
    google.set("lostone", {
      id: "lostone",
      status: "confirmed",
      summary: "Math class",
      start: { dateTime: at(8, 22).toISOString() },
      end: { dateTime: at(8, 23).toISOString() },
      extendedProperties: { private: { hubEventId: lost.id } },
    });
    requests.length = 0;
    expect(await run()).toMatchObject({ created: 1 });
    expect(writes()).toEqual([]);
    const [link] = await db.select().from(householdLinks).where(eq(householdLinks.hubKey, lost.id));
    expect(link.googleEventId).toBe("lostone");
    // The next run sends the hub's version over it.
    expect(await run()).toMatchObject({ updated: 1 });
  });

  it("never deletes the family's own event, even with a bad link (TWSEC-1)", async () => {
    await db.insert(householdLinks).values({
      sourceId,
      hubKey: randomUUID(),
      googleEventId: "familydinner",
      origin: "hub",
      hash: "x",
    });
    expect(await run()).toMatchObject({ deleted: 0 });
    expect(google.has("familydinner")).toBe(true);
    // The bad link is gone, so it isn't tried again.
    expect(
      await db.select().from(householdLinks).where(eq(householdLinks.googleEventId, "familydinner")),
    ).toEqual([]);
  });

  it("holds a run that would delete more than ten events (TWSEC-2)", async () => {
    for (let i = 0; i < 11; i++) {
      const key = randomUUID();
      google.set(`stale${i}`, {
        id: `stale${i}`,
        status: "confirmed",
        start: { dateTime: at(9, 10).toISOString() },
        end: { dateTime: at(9, 11).toISOString() },
        extendedProperties: { private: { hubEventId: key } },
      });
      await db
        .insert(householdLinks)
        .values({ sourceId, hubKey: key, googleEventId: `stale${i}`, origin: "hub", hash: "x" });
    }
    requests.length = 0;
    expect(await run()).toMatchObject({ held: expect.stringContaining("delete 11") });
    expect(writes()).toEqual([]);
    await applyHeld(db, launcher);
    expect(await run()).toMatchObject({ deleted: 11 });
  });

  it("starts the job after a change, but not again before it begins (TWO-3)", async () => {
    started.length = 0;
    const later = new Date(now.getTime() + 60_000);
    expect(await nudgeHouseholdSync(db, launcher, later)).toBe(true);
    expect(await nudgeHouseholdSync(db, launcher, new Date(later.getTime() + 1000))).toBe(false);
    expect(started).toEqual([["household:sync"]]);
  });
  // H3. Google's `updated` for an edit made there, after the hub last saw it.
  const editInGoogle = (id: string, change: Partial<GEvent>, updated = new Date(Date.now() + 1000)) =>
    google.set(id, { ...google.get(id)!, ...change, updated: updated.toISOString() });
  const googleIdOf = async (hubKey: string) =>
    (await db.select().from(householdLinks).where(eq(householdLinks.hubKey, hubKey)))[0]?.googleEventId;
  const activeOverride = async (eventId: string) =>
    (
      await db
        .select()
        .from(eventOverrides)
        .where(and(eq(eventOverrides.eventId, eventId), isNull(eventOverrides.clearedAt)))
    )[0];
  const eventRow = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

  let tennisFeed: string;
  let tennis: string;
  const tennisRecord = (start: Date) => ({
    externalId: `match-${credentialId}`,
    title: "Tennis match",
    category: "tennis" as const,
    attendance: "required" as const,
    notes: null,
    locationName: "Tennis club",
    startUtc: start,
    endUtc: new Date(start.getTime() + 3_600_000),
    allDay: false,
    sourceUrl: null,
  });
  const feedSync = (start: Date) =>
    syncRecords(
      db,
      { sourceId: tennisFeed },
      [tennisRecord(start)],
      { from: at(1, 0), to: at(31, 0) },
      {
        actor: "sync",
      },
    );

  it("turns a Google move of a feed's event into an override, and puts its title back (BACK-3)", async () => {
    const [feed] = await db
      .insert(sources)
      .values({ kind: "ical", name: `Tennis ${credentialId}`, config: {}, enabled: false })
      .returning();
    tennisFeed = feed.id;
    await feedSync(at(10, 22));
    tennis = (await db.select().from(events).where(eq(events.sourceId, tennisFeed)))[0].id;
    ids.push(tennis);
    expect(await run()).toMatchObject({ created: 1, fromGoogle: 0 });
    const gid = (await googleIdOf(tennis))!;

    editInGoogle(gid, {
      summary: "Tennis (moved)",
      start: { dateTime: at(10, 18).toISOString() },
      end: { dateTime: at(10, 19).toISOString() },
    });
    requests.length = 0;
    expect(await run()).toMatchObject({ fromGoogle: 1, updated: 1 });
    const o = await activeOverride(tennis);
    expect(o).toMatchObject({ createdBy: GOOGLE_ACTOR, newStartUtc: at(10, 18), newEndUtc: at(10, 19) });
    // The title goes back; the time stays as moved in Google.
    expect(google.get(gid)!.summary).toBe(`${primary.name} – Tennis match`);
    expect(google.get(gid)!.start).toMatchObject({ dateTime: at(10, 18).toISOString() });
    // Nothing more to do after that (DUP2-1).
    requests.length = 0;
    expect(await run()).toMatchObject({ fromGoogle: 0, updated: 0, created: 0 });
    expect(writes()).toEqual([]);

    // The feed moves it later: the badge, as for a drag (CON-5), and the
    // Google move stays.
    await feedSync(at(10, 21));
    expect((await activeOverride(tennis))!.sourceChangedAt).not.toBeNull();
    expect(await run()).toMatchObject({ fromGoogle: 0, updated: 0 });
    expect(google.get(gid)!.start).toMatchObject({ dateTime: at(10, 18).toISOString() });
  });

  it("skips a feed's event deleted in Google (BACK-3)", async () => {
    const gid = (await googleIdOf(tennis))!;
    google.delete(gid);
    expect(await run()).toMatchObject({ fromGoogle: 1, created: 0 });
    expect((await activeOverride(tennis))!.skip).toBe(true);
    expect(await googleIdOf(tennis)).toBeUndefined();
    // Not written again while skipped.
    expect(await run()).toMatchObject({ created: 0 });
  });

  let dentist: string;
  it("gives an event added here Google's title, time and place (BACK-4)", async () => {
    const [row] = await db
      .insert(events)
      .values({ title: "Dentist", category: "other", startUtc: at(12, 17), endUtc: at(12, 18) })
      .returning({ id: events.id });
    dentist = row.id;
    ids.push(dentist);
    expect(await run()).toMatchObject({ created: 1 });
    const gid = (await googleIdOf(dentist))!;
    expect(google.get(gid)!.summary).toBe(`${primary.name} – Dentist`);

    editInGoogle(gid, {
      summary: `${primary.name} – Dentist check-up`,
      location: "Main St clinic",
      start: { dateTime: at(12, 19).toISOString() },
      end: { dateTime: at(12, 20).toISOString() },
    });
    expect(await run()).toMatchObject({ fromGoogle: 1 });
    expect(await eventRow(dentist)).toMatchObject({
      title: "Dentist check-up",
      locationName: "Main St clinic",
      startUtc: at(12, 19),
      endUtc: at(12, 20),
      ownerIds: [primary.id],
    });
    // Google already has it; the summary is the same either way.
    expect(google.get(gid)!.summary).toBe(`${primary.name} – Dentist check-up`);
    requests.length = 0;
    expect(await run()).toMatchObject({ fromGoogle: 0, updated: 0 });
    expect(writes()).toEqual([]);
  });

  it("lets the later change win when both sides changed (BACK-5)", async () => {
    const gid = (await googleIdOf(dentist))!;
    const [link] = await db.select().from(householdLinks).where(eq(householdLinks.hubKey, dentist));
    const input = (e: Awaited<ReturnType<typeof eventRow>>, locationName: string) => ({
      title: e.title,
      category: "other" as const,
      attendance: "required" as const,
      ownerIds: e.ownerIds,
      start: e.startUtc,
      end: e.endUtc,
      allDay: false,
      notes: null,
      locationName,
    });

    // Google first, the hub later: the hub's place wins.
    editInGoogle(gid, { location: "Google's place" }, new Date(link.googleUpdatedAt!.getTime() + 1));
    await updateEvent(db, "owner", dentist, input(await eventRow(dentist), "Hub's place"));
    expect(await run()).toMatchObject({ fromGoogle: 0, updated: 1 });
    expect(google.get(gid)!.location).toBe("Hub's place");
    expect((await eventRow(dentist)).locationName).toBe("Hub's place");

    // The hub first, Google later: Google's wins.
    await updateEvent(db, "owner", dentist, input(await eventRow(dentist), "Hub again"));
    editInGoogle(gid, { location: "Google again" }, new Date(Date.now() + 5000));
    expect(await run()).toMatchObject({ fromGoogle: 1 });
    expect((await eventRow(dentist)).locationName).toBe("Google again");
    expect(google.get(gid)!.location).toBe("Google again");
  });

  it("deletes an event added here when it is deleted in Google (BACK-4)", async () => {
    google.delete((await googleIdOf(dentist))!);
    expect(await run()).toMatchObject({ fromGoogle: 1, created: 0 });
    expect((await eventRow(dentist)).deletedAt).not.toBeNull();
    expect(await googleIdOf(dentist)).toBeUndefined();
  });

  it("patches Google when a household event is moved in the hub, then clears the override (TWO-4)", async () => {
    const [dinner] = (await householdRows()).filter((r) => r.externalId === "familydinner");
    await moveEvent(db, "owner", dinner.id, { start: at(6, 22), end: at(7, 0) });
    requests.length = 0;
    expect(await run()).toMatchObject({ updated: 1 });
    expect(writes()).toEqual([
      expect.objectContaining({ method: "PATCH", path: expect.stringContaining("familydinner") }),
    ]);
    const g = google.get("familydinner")!;
    expect(g.start).toMatchObject({ dateTime: at(6, 22).toISOString() });
    // Still the family's own event, not the hub's.
    expect(g.extendedProperties).toBeUndefined();
    expect(await activeOverride(dinner.id)).toBeUndefined();
    expect(await eventRow(dinner.id)).toMatchObject({ startUtc: at(6, 22), endUtc: at(7, 0) });
    // The next read agrees, and nothing more is written.
    await read();
    requests.length = 0;
    expect(await run()).toMatchObject({ updated: 0 });
    expect(writes()).toEqual([]);
  });

  it("cancels one skipped occurrence of a repeating household event, and keeps a one-off skip here (TWO-4)", async () => {
    for (const day of [13, 20])
      google.set(`lessons_204103${day}T220000Z`, {
        id: `lessons_204103${day}T220000Z`,
        recurringEventId: "lessons",
        status: "confirmed",
        summary: "Piano lessons",
        start: { dateTime: at(day, 22).toISOString() },
        end: { dateTime: at(day, 23).toISOString() },
        updated: now.toISOString(),
      });
    await read();
    const rows = await householdRows();
    const first = rows.find((r) => r.externalId === "lessons_20410313T220000Z")!;
    const dinner = rows.find((r) => r.externalId === "familydinner")!;
    await skipEvent(db, "owner", first.id, true);
    await skipEvent(db, "owner", dinner.id, true);
    requests.length = 0;
    expect(await run()).toMatchObject({ deleted: 1 });
    expect(writes()).toEqual([
      expect.objectContaining({
        method: "DELETE",
        path: expect.stringContaining("lessons_20410313T220000Z"),
      }),
    ]);
    expect(google.has("lessons_20410320T220000Z")).toBe(true);
    expect(google.has("familydinner")).toBe(true);
    expect((await eventRow(first.id)).status).toBe("cancelled");
    expect(await activeOverride(first.id)).toBeUndefined();
    expect((await activeOverride(dinner.id))!.skip).toBe(true);
    await skipEvent(db, "owner", dinner.id, false);
  });

  it("deletes a household event deleted in the hub from Google (TWO-4)", async () => {
    const second = (await householdRows()).find((r) => r.externalId === "lessons_20410320T220000Z")!;
    await deleteEvent(db, "owner", second.id);
    requests.length = 0;
    expect(await run()).toMatchObject({ deleted: 1 });
    expect(google.has("lessons_20410320T220000Z")).toBe(false);
    expect((await eventRow(second.id)).status).toBe("cancelled");
  });

  it("deletes a household event in the hub only while two-way sync is off (intent 0022, DEL-4)", async () => {
    await setHouseholdSync(db, { mode: "off", sourceId }, launcher);
    const dinner = (await householdRows()).find((r) => r.externalId === "familydinner")!;
    await deleteEvent(db, "owner", dinner.id);
    // Switched On later, the run leaves it in Google.
    await setHouseholdSync(db, { mode: "on", sourceId }, launcher);
    requests.length = 0;
    expect(await run()).toMatchObject({ deleted: 0 });
    expect(writes().filter((w) => w.method === "DELETE")).toEqual([]);
    expect(google.has("familydinner")).toBe(true);
    expect((await eventRow(dinner.id)).deletedAt).not.toBeNull();
  });
});
