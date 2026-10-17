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
import type { Person } from "@/domain/people";
import { aadFor } from "@/server/credentials/aad";
import { seal } from "@/server/crypto/envelope";
import { defaultKeyWrapper } from "@/server/crypto/key-wrapper";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { applyHeld, getHouseholdSync, nudgeHouseholdSync, setHouseholdSync } from "@/server/household-sync";
import type { JobLauncher } from "@/server/jobs/launcher";
import { createLogger } from "@/server/log";
import { listPeople } from "@/server/people";
import { runHouseholdSync } from "@/worker/household-sync";
import { syncSource } from "@/worker/sync";

// Intent 0020, H2: the hub writes its events into the household calendar
// (TWO), against a fake Google Calendar that records every request. The
// household read and the write take turns without ever making a second
// copy (DUP2-1), a lost answer is found again (DUP2-3), the family's own
// events are fenced (TWSEC-1) and big runs are held (TWSEC-2).

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
    expect(await run()).toEqual({ created: 1, updated: 0, linked: 1, deleted: 0, unlinked: 0 });
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
      expect(await run()).toEqual({ created: 0, updated: 0, linked: 0, deleted: 0, unlinked: 0 });
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
});
