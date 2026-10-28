import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deviceLocations, devices, events, leaveAlerts, notifications, sources } from "@db/schema";
import { createSession, findSession, type SessionUser } from "@/server/auth/session";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { checkLeave } from "@/server/leave/check";
import { createLogger } from "@/server/log";
import type { PushSender, PushTarget } from "@/server/push/apns";
import { saveLocation } from "@/server/push/location";
import { registerDevice, setDeviceKinds } from "@/server/push/notify";
import { setHomeAddress } from "@/server/settings";
import type { Place, RouteFn } from "@/server/traffic/routes";

// The "Time to leave" job (intent 0027, TRF-E, TRF-R, TRF-P, TRFSEC-2)
// against the test database, with a fake route service and a fake APNs.

const OWNER = "owner@example.test";
const HOME = { lat: 43.65, lng: -79.38 };
const FIELD = { lat: 43.72, lng: -79.45 };
const MIN = 60_000;

describe("time to leave", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  const lines: string[] = [];
  const log = createLogger((line) => lines.push(line));
  const pushed: { to: PushTarget; payload: Record<string, unknown> }[] = [];
  const sender: PushSender = {
    async send(to, payload) {
      pushed.push({ to, payload });
      return "sent";
    },
  };
  // The fake route service: a set drive time, or a failure.
  let drive: number | null | "error" = 25;
  const asked: Place[] = [];
  const routes: RouteFn = async (origin) => {
    asked.push(origin);
    if (drive === "error") throw new Error("Routes API 503");
    if (drive === null) return null;
    return { minutes: drive, start: "address" in origin ? HOME : origin, end: FIELD };
  };

  beforeAll(async () => {
    process.env.ALLOWED_EMAILS = OWNER;
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
  });
  afterAll(async () => {
    delete process.env.ALLOWED_EMAILS;
    await handle.close();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate conflicts, event_overrides, event_revisions, events, event_series, change_log restart identity cascade`,
    );
    await db.delete(devices);
    await db.delete(notifications);
    await setHomeAddress(db, "1 Home Street, Toronto");
    pushed.length = 0;
    asked.length = 0;
    lines.length = 0;
    drive = 25;
  });

  async function phone(token: string): Promise<SessionUser> {
    const { token: t } = await createSession(db, OWNER, "HubApp/1", { kind: "device", deviceName: "Test" });
    const s = (await findSession(db, t))!;
    await registerDevice(db, s, { token, environment: "sandbox", topic: "com.jaydenguo.hub" });
    await setDeviceKinds(db, s, { kinds: ["leave"] });
    return s;
  }
  async function event(start: Date, over: Partial<typeof events.$inferInsert> = {}) {
    const [src] = await db.insert(sources).values({ kind: "ical", name: "Leave test" }).returning();
    const [row] = await db
      .insert(events)
      .values({
        sourceId: src.id,
        externalId: crypto.randomUUID(),
        category: "tennis",
        title: "Tennis",
        locationName: "Bayview Tennis Club, Toronto",
        startUtc: start,
        endUtc: new Date(start.getTime() + 60 * MIN),
        ...over,
      })
      .returning();
    return row;
  }
  const run = (now: Date) => checkLeave(db, { routes, sender, log, now });

  it("sends leave-by once, ten minutes before, from home when the phone hasn't shared a place (TRF-P1, TRF-R2)", async () => {
    await phone("a".repeat(64));
    const t0 = new Date(Math.ceil(Date.now() / MIN) * MIN + 60 * MIN);
    const e = await event(t0);
    // Leave-by is 30 min before (25 drive + 5 park): 50 min out, nothing yet.
    expect((await run(new Date(t0.getTime() - 50 * MIN))).sent).toBe(0);
    expect(asked[0]).toEqual({ address: "1 Home Street, Toronto" });
    expect((await run(new Date(t0.getTime() - 40 * MIN))).sent).toBe(1);
    expect((await run(new Date(t0.getTime() - 35 * MIN))).sent).toBe(0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload.kind).toBe("leave");
    const [n] = await db.select().from(notifications);
    expect(n).toMatchObject({ kind: "leave", target: `events/${e.id}` });
    expect(n.title).toMatch(/^Leave by \d+:\d\d for Tennis$/);
    expect(n.body).toBe("Bayview Tennis Club, Toronto: 25 min with traffic.");
    // No fresh place: no running-late push.
    expect((await run(new Date(t0.getTime() - 20 * MIN))).sent).toBe(0);
  });

  it("tells running late when the phone hasn't moved, and stays quiet once it has (TRF-P3, TRF-P4)", async () => {
    const s = await phone("a".repeat(64));
    const moving = await phone("b".repeat(64));
    const t0 = new Date(Math.ceil(Date.now() / MIN) * MIN + 45 * MIN);
    await event(t0);
    await saveLocation(db, s, HOME);
    await saveLocation(db, moving, HOME);
    await run(new Date(t0.getTime() - 40 * MIN));
    expect(pushed).toHaveLength(2);
    await saveLocation(db, moving, FIELD);
    await run(new Date(t0.getTime() - 25 * MIN));
    expect(pushed).toHaveLength(3);
    const late = (await db.select().from(notifications)).find((n) => n.title.startsWith("Leave now"));
    expect(late?.body).toMatch(/^You'll get there at \d+:\d\d, \d+ min late \(25 min with traffic\)\.$/);
    expect(pushed[2].to.token).toBe("a".repeat(64));
    // Each phone's own dedup: at most one late per phone and event.
    await run(new Date(t0.getTime() - 20 * MIN));
    expect(pushed).toHaveLength(3);
  });

  it("covers only the chosen people's required, timed events with a place (TRF-E1, TRF-A3)", async () => {
    const s = await phone("a".repeat(64));
    const t0 = new Date(Math.ceil(Date.now() / MIN) * MIN + 30 * MIN);
    await event(t0, { attendance: "optional" });
    await event(t0, { locationName: null });
    await event(t0, { category: "school_class" });
    await event(new Date(t0.getTime() + 3 * 3_600_000));
    expect((await run(new Date(t0.getTime() - 25 * MIN))).routes).toBe(0);
    const [person] = await db
      .execute<{ id: string }>(sql`select id from people where is_primary`)
      .then((r) => r.rows);
    await event(t0, { ownerIds: [person.id] });
    await setDeviceKinds(db, s, { leavePeople: [crypto.randomUUID()] });
    expect((await run(new Date(t0.getTime() - 25 * MIN))).routes).toBe(0);
    await setDeviceKinds(db, s, { leavePeople: [person.id] });
    expect((await run(new Date(t0.getTime() - 25 * MIN))).sent).toBe(1);
  });

  it("gives up quietly on routes that fail or don't resolve, and never logs a place (TRF-E2, TRF-R4, TRFSEC-2)", async () => {
    const s = await phone("a".repeat(64));
    await saveLocation(db, s, HOME);
    const t0 = new Date(Math.ceil(Date.now() / MIN) * MIN + 100 * MIN);
    await event(t0);
    drive = "error";
    for (const m of [100, 70, 40, 10]) await run(new Date(t0.getTime() - m * MIN));
    expect(asked).toHaveLength(3);
    expect(lines.filter((l) => l.includes("leave: route failed"))).toHaveLength(1);
    await db.delete(leaveAlerts);
    drive = null;
    await run(new Date(t0.getTime() - 100 * MIN));
    await run(new Date(t0.getTime() - 60 * MIN));
    expect(lines.filter((l) => l.includes("leave: no route"))).toHaveLength(1);
    expect(pushed).toHaveLength(0);
    const all = lines.join("\n");
    expect(all).not.toMatch(/43\.65|79\.38|Home Street|Bayview/);
  });

  it("forgets places a day old and alerts for events long past", async () => {
    const s = await phone("a".repeat(64));
    await saveLocation(db, s, HOME);
    const t0 = new Date(Math.ceil(Date.now() / MIN) * MIN + 30 * MIN);
    await event(t0);
    await run(new Date(t0.getTime() - 25 * MIN));
    expect(await db.select().from(leaveAlerts)).toHaveLength(1);
    await run(new Date(t0.getTime() + 25 * 3_600_000));
    expect(await db.select().from(deviceLocations)).toHaveLength(0);
    expect(await db.select().from(leaveAlerts)).toHaveLength(0);
  });
});
