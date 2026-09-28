import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calendarCopyEvents, credentials, eventOverrides, events, settings, sources } from "@db/schema";
import { COPY_SCOPE, getCopySettings, setCopy } from "@/server/calendar-copy";
import { aadFor } from "@/server/credentials/aad";
import { seal } from "@/server/crypto/envelope";
import { defaultKeyWrapper } from "@/server/crypto/key-wrapper";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import type { JobLauncher } from "@/server/jobs/launcher";
import { createLogger } from "@/server/log";
import { calendarCopyJob, copyCalendar } from "@/worker/calendar-copy";

// The Google Calendar copy (plan M5.9, GCO-1, GCO-2) against a fake Google
// Calendar that records every request: it creates its own calendar, copies
// the calendar as shown (moves applied, skipped and cancelled left out),
// writes only changes, and never touches the household calendar.

type Req = { method: string; path: string; body: Record<string, unknown> | null };

describe("Google Calendar copy", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let base = "";
  const requests: Req[] = [];
  const calendars = new Map<string, Map<string, Record<string, unknown>>>();
  const HOUSEHOLD = "family-household@group.calendar.google.com";
  // Far enough ahead that only this test's events are in the copied range.
  const now = new Date("2033-01-10T12:00:00Z");
  const started: string[][] = [];
  const launcher: JobLauncher = { start: async (a) => void started.push(a) };
  const log = createLogger((l) => process.env.DEBUG_LOG && console.log(l));
  const ids: string[] = [];
  let credentialId: string;
  const saved: Record<string, string | undefined> = {};

  const writes = () => requests.filter((r) => r.method !== "GET");

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
        return send(200, { access_token: "cal-token", token_type: "Bearer", expires_in: 300 });
      if (!url.pathname.startsWith("/calendar/v3/")) return send(404);
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      requests.push({ method: req.method!, path: decodeURIComponent(url.pathname), body });
      if (req.headers.authorization !== "Bearer cal-token") return send(401);
      const parts = url.pathname.slice("/calendar/v3/".length).split("/").map(decodeURIComponent);
      if (parts[0] !== "calendars") return send(404);
      if (parts.length === 1 && req.method === "POST") {
        const id = `hub-${randomUUID()}@group.calendar.google.com`;
        calendars.set(id, new Map());
        return send(200, { id, ...body });
      }
      const cal = calendars.get(parts[1]);
      if (!cal) return send(404);
      if (parts.length === 2) {
        if (req.method === "DELETE") return (calendars.delete(parts[1]), send(204));
        return send(200, { id: parts[1] });
      }
      if (parts[2] === "events" && parts.length === 3 && req.method === "POST") {
        const id = randomUUID().replace(/-/g, "");
        cal.set(id, body!);
        return send(200, { id, ...body });
      }
      if (parts[2] === "events" && parts.length === 4) {
        if (!cal.has(parts[3])) return send(404);
        if (req.method === "PUT") return (cal.set(parts[3], body!), send(200, { id: parts[3], ...body }));
        if (req.method === "DELETE") return (cal.delete(parts[3]), send(204));
      }
      send(404);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const k of [
      "OIDC_ISSUER",
      "GOOGLE_API_BASE",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "CALENDAR_COPY_GAP_MS",
    ])
      saved[k] = process.env[k];
    Object.assign(process.env, {
      OIDC_ISSUER: base,
      GOOGLE_API_BASE: base,
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-secret",
      CALENDAR_COPY_GAP_MS: "0",
    });

    credentialId = randomUUID();
    await db.insert(credentials).values({
      id: credentialId,
      kind: "oauth",
      provider: "google",
      label: "Google (copy@example.test)",
      username: `copy-${credentialId}@example.test`,
      scopes: [COPY_SCOPE],
      ...(await seal(defaultKeyWrapper(), `refresh-${credentialId}`, aadFor(credentialId))),
    });
    // The household calendar is a source; the copy must never write to it.
    await db.insert(sources).values({
      kind: "google_calendar",
      name: `Household ${credentialId}`,
      credentialId,
      config: { calendarId: HOUSEHOLD },
      enabled: false,
    });
    const at = (h: number, day = 12) => new Date(Date.UTC(2033, 0, day, h));
    const rows = await db
      .insert(events)
      .values([
        { title: "Copy: swim", category: "swimming", startUtc: at(22), endUtc: at(23), locationName: "Pool" },
        { title: "Copy: moved", category: "tennis", startUtc: at(14), endUtc: at(15) },
        { title: "Copy: skipped", category: "soccer", startUtc: at(16), endUtc: at(17) },
        {
          title: "Copy: cancelled",
          category: "hockey",
          startUtc: at(18),
          endUtc: at(19),
          status: "cancelled",
        },
        {
          title: "Copy: PD day",
          category: "school_closure",
          allDay: true,
          startUtc: at(0, 13),
          endUtc: at(0, 14),
        },
      ])
      .returning({ id: events.id, title: events.title });
    ids.push(...rows.map((r) => r.id));
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r.id]));
    await db.insert(eventOverrides).values([
      { eventId: byTitle["Copy: moved"], newStartUtc: at(20), newEndUtc: at(21), createdBy: "owner" },
      { eventId: byTitle["Copy: skipped"], skip: true, createdBy: "owner" },
    ]);
    await db.delete(settings).where(eq(settings.key, "calendar_copy"));
  });

  afterAll(async () => {
    await db.delete(settings).where(eq(settings.key, "calendar_copy"));
    await db.delete(calendarCopyEvents).where(inArray(calendarCopyEvents.eventId, ids));
    await db.delete(eventOverrides).where(inArray(eventOverrides.eventId, ids));
    await db.delete(events).where(inArray(events.id, ids));
    await db.delete(sources).where(eq(sources.credentialId, credentialId));
    await db.delete(credentials).where(eq(credentials.id, credentialId));
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    await new Promise((r) => server.close(r));
    await handle.close();
  });

  it("does nothing while switched off", async () => {
    expect(await copyCalendar(db, now)).toEqual({ skipped: "switched off" });
    expect(requests).toEqual([]);
  });

  it("switching on needs an account that granted the copy scope, then starts a copy", async () => {
    await expect(setCopy(db, { enabled: true, credentialId: randomUUID() }, launcher)).rejects.toMatchObject({
      status: 400,
    });
    await setCopy(db, { enabled: true, credentialId }, launcher);
    expect(started).toEqual([["calendar:copy"]]);
  });

  it("creates the Jayden (hub) calendar and copies the calendar as shown", async () => {
    expect(await copyCalendar(db, now)).toEqual({ created: 3, updated: 0, deleted: 0 });
    const created = requests.find((r) => r.method === "POST" && r.path === "/calendar/v3/calendars")!;
    expect(created.body).toMatchObject({ summary: "Jayden (hub)", timeZone: expect.any(String) });
    const { calendarId } = await getCopySettings(db);
    const copy = [...calendars.get(calendarId!)!.values()];
    expect(copy.map((e) => e.summary).sort()).toEqual(["Copy: PD day", "Copy: moved", "Copy: swim"]);
    const moved = copy.find((e) => e.summary === "Copy: moved")!;
    // The owner's move is what's copied.
    expect(moved.start).toMatchObject({ dateTime: "2033-01-12T20:00:00.000Z" });
    expect(copy.find((e) => e.summary === "Copy: PD day")!.start).toEqual({ date: "2033-01-13" });
  });

  it("writes nothing when nothing changed, and only the change when one did", async () => {
    const before = writes().length;
    expect(await copyCalendar(db, now)).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(writes().length).toBe(before);

    await db.update(events).set({ title: "Copy: swim meet" }).where(eq(events.id, ids[0]));
    expect(await copyCalendar(db, now)).toEqual({ created: 0, updated: 1, deleted: 0 });

    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, ids[0]));
    expect(await copyCalendar(db, now)).toEqual({ created: 0, updated: 0, deleted: 1 });
  });

  it("never writes to the household calendar or the primary calendar (GCO-1)", () => {
    for (const r of writes()) {
      expect(r.path).not.toContain(HOUSEHOLD);
      expect(r.path).not.toContain("/primary");
    }
    expect(writes().every((r) => r.path === "/calendar/v3/calendars" || r.path.includes("hub-"))).toBe(true);
  });

  it("switched off and kept: no more updates (GCO-2)", async () => {
    await setCopy(db, { enabled: false, keep: true }, launcher);
    const before = requests.length;
    await db.update(events).set({ title: "Copy: renamed" }).where(eq(events.id, ids[1]));
    expect(await copyCalendar(db, now)).toEqual({ skipped: "switched off" });
    expect(requests.length).toBe(before);
    expect(started.at(-1)).toEqual(["calendar:copy"]);
  });

  it("switched off and deleted: the copy calendar is deleted", async () => {
    const { calendarId } = await getCopySettings(db);
    await setCopy(db, { enabled: false, keep: false }, launcher);
    expect(started.at(-1)).toEqual(["calendar:copy", "delete"]);
    await calendarCopyJob(["delete"], { log, db: async () => db });
    expect(calendars.has(calendarId!)).toBe(false);
    expect((await getCopySettings(db)).calendarId).toBeNull();
    expect(
      await db.select().from(calendarCopyEvents).where(inArray(calendarCopyEvents.eventId, ids)),
    ).toEqual([]);
  });
});
