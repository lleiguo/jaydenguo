import { generateKeyPairSync, verify } from "node:crypto";
import { createServer, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conflicts, devices, events, notifications, sessions, sources, tennisEntries } from "@db/schema";
import { createSession, findSession, type SessionUser } from "@/server/auth/session";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { HttpError } from "@/server/errors";
import { createLogger } from "@/server/log";
import { notifyClashes, notifyEntryChange, notifySyncFailed } from "@/server/push/kinds";
import {
  deviceSettings,
  getNotification,
  notify,
  registerDevice,
  setDeviceKinds,
} from "@/server/push/notify";

// Notifications (intent 0004, PUSH-1..6, plan N7) against a fake APNs over
// HTTP/2: what reaches Apple, who gets it, dedup, and dead tokens.

const OWNER = "owner@example.test";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const DEAD = "d".repeat(64);

type Sent = {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
};

describe("push notifications", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let apns: Http2Server;
  const sent: Sent[] = [];
  const open = new Set<ServerHttp2Session>();
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const log = createLogger(() => {});

  beforeAll(async () => {
    process.env.ALLOWED_EMAILS = OWNER;
    apns = createServer((req, res) => {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => (data += c));
      req.on("end", () => {
        sent.push({ path: req.headers[":path"] as string, headers: req.headers, body: JSON.parse(data) });
        if ((req.headers[":path"] as string).endsWith(DEAD)) {
          res.writeHead(410, { "content-type": "application/json" });
          res.end(JSON.stringify({ reason: "Unregistered" }));
        } else {
          res.writeHead(200);
          res.end();
        }
      });
    });
    apns.on("session", (session) => open.add(session));
    await new Promise<void>((r) => apns.listen(0, "127.0.0.1", r));
    process.env.APNS_KEY = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    process.env.APNS_KEY_ID = "KEY1234567";
    process.env.APNS_TEAM_ID = "TEAM123456";
    process.env.APNS_BASE_URL = `http://127.0.0.1:${(apns.address() as AddressInfo).port}`;
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
  });
  afterAll(async () => {
    for (const k of ["ALLOWED_EMAILS", "APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BASE_URL"])
      delete process.env[k];
    for (const session of open) session.destroy();
    await new Promise((r) => apns.close(r));
    await handle.close();
  });
  beforeEach(async () => {
    await db.delete(devices);
    await db.delete(notifications);
    sent.length = 0;
  });

  async function phone(kind: "device" | "browser" = "device"): Promise<SessionUser> {
    const { token } = await createSession(db, OWNER, "HubApp/1", { kind, deviceName: "Test iPhone" });
    return (await findSession(db, token))!;
  }
  const register = (s: SessionUser, token: string) =>
    registerDevice(db, s, { token, environment: "sandbox", topic: "com.jaydenguo.hub" });
  const note = (key: string, kind: "clash" | "suggestion" = "clash") => ({
    kind,
    dedupKey: key,
    title: "Clash on Sat 4 Oct",
    body: "Soccer and Swim practice",
    target: "events/x",
  });

  it("registers a phone with the default kinds, and lets it choose (PUSH-3)", async () => {
    await expect(register(await phone("browser"), TOKEN_A)).rejects.toBeInstanceOf(HttpError);
    const s = await phone();
    expect((await deviceSettings(db, s)).registered).toBe(false);
    const settings = await register(s, TOKEN_A);
    expect(settings.registered).toBe(true);
    expect(settings.kinds).not.toContain("suggestion");
    expect(settings.kinds).toContain("clash");
    expect(settings.available.map((a) => a.kind)).toContain("suggestion");
    const chosen = await setDeviceKinds(db, s, ["suggestion", "video"]);
    expect(chosen.kinds.sort()).toEqual(["suggestion", "video"]);
    // A new token for the same phone keeps its choice.
    expect((await register(s, TOKEN_B)).kinds.sort()).toEqual(["suggestion", "video"]);
    // The token moves to a new sign-in: the old row goes.
    const again = await phone();
    await register(again, TOKEN_B);
    expect(await db.select().from(devices)).toHaveLength(1);
  });

  it("sends only an id and a kind to Apple, once per event (PUSH-2, PUSH-5, PUSH-6)", async () => {
    const s = await phone();
    await register(s, TOKEN_A);
    const id = await notify(db, note("clash:1|2"), { log });
    expect(id).toBeTruthy();
    expect(sent).toHaveLength(1);
    const [push] = sent;
    expect(push.path).toBe(`/3/device/${TOKEN_A}`);
    expect(push.headers["apns-topic"]).toBe("com.jaydenguo.hub");
    expect(push.headers["apns-push-type"]).toBe("alert");
    expect(push.body).toEqual({
      aps: { alert: { title: "Hub", body: "New update" }, "mutable-content": 1, sound: "default" },
      id,
      kind: "clash",
    });
    expect(JSON.stringify(push.body)).not.toContain("Soccer");
    // The JWT is signed with the key and names the key and team.
    const jwt = String(push.headers.authorization).replace("bearer ", "");
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString()).iss).toBe("TEAM123456");
    expect(
      verify(
        "sha256",
        Buffer.from(`${h}.${c}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(sig, "base64url"),
      ),
    ).toBe(true);

    // The extension fetches the text.
    expect(await getNotification(db, id!)).toMatchObject({ title: "Clash on Sat 4 Oct", target: "events/x" });

    // The same event again: nothing new.
    expect(await notify(db, note("clash:1|2"), { log })).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("keeps Cookie's kind out of old apps' lists, and sends it only to the parent who asked (intent 0009, ERA-3)", async () => {
    const mine = await phone();
    const settings = await register(mine, TOKEN_A);
    // Builds before it don't know the kind: not on by default, not listed.
    expect(settings.kinds).not.toContain("cookie");
    expect(settings.available.map((a) => a.kind)).not.toContain("cookie");
    // An app that knows it turns it on itself.
    await setDeviceKinds(db, mine, [...settings.kinds, "cookie"]);

    process.env.ALLOWED_EMAILS = `${OWNER},other-parent@example.test`;
    try {
      const { token } = await createSession(db, "other-parent@example.test", "HubApp/1", {
        kind: "device",
        deviceName: "Other iPhone",
      });
      const theirs = (await findSession(db, token))!;
      await register(theirs, TOKEN_B);
      await setDeviceKinds(db, theirs, ["cookie"]);

      await notify(
        db,
        {
          kind: "cookie",
          dedupKey: "cookie_read:1",
          title: "Cookie's answer is ready",
          body: "Open the chat to read it.",
          target: "cookie",
        },
        { log, userId: mine.userId },
      );
      expect(sent.map((p) => p.path.slice(-64))).toEqual([TOKEN_A]);
    } finally {
      process.env.ALLOWED_EMAILS = OWNER;
    }
  });

  it("skips phones that don't want the kind or are signed out, and drops dead tokens", async () => {
    const wants = await phone();
    await register(wants, TOKEN_A);
    const signedOut = await phone();
    await register(signedOut, TOKEN_B);
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, signedOut.sessionId));
    const dead = await phone();
    await register(dead, DEAD);

    await notify(db, note("suggestion:1", "suggestion"), { log });
    expect(sent).toHaveLength(0);
    await notify(db, note("clash:3|4"), { log });
    expect(sent.map((p) => p.path.slice(-64)).sort()).toEqual([TOKEN_A, DEAD].sort());
    expect((await db.select().from(devices)).map((d) => d.token).sort()).toEqual([TOKEN_A, TOKEN_B].sort());
  });

  it("notifies a new clash once, and not an accepted one (PUSH-1, PUSH-5)", async () => {
    await register(await phone(), TOKEN_A);
    const [src] = await db.insert(sources).values({ kind: "ical", name: "Push test" }).returning();
    const at = (h: number) => new Date(Date.now() + 3 * 86_400_000 + h * 3_600_000);
    const [a, b, c, d] = await db
      .insert(events)
      .values([
        {
          sourceId: src.id,
          externalId: "p1",
          category: "soccer",
          title: "Soccer game",
          startUtc: at(0),
          endUtc: at(2),
        },
        {
          sourceId: src.id,
          externalId: "p2",
          category: "swimming",
          title: "Swim practice",
          startUtc: at(1),
          endUtc: at(3),
        },
        {
          sourceId: src.id,
          externalId: "p3",
          category: "soccer",
          title: "Soccer training",
          startUtc: at(30),
          endUtc: at(32),
        },
        {
          sourceId: src.id,
          externalId: "p4",
          category: "tennis",
          title: "Tennis lesson",
          startUtc: at(31),
          endUtc: at(33),
        },
      ])
      .returning();
    await db
      .insert(conflicts)
      .values({ eventA: c.id < d.id ? c.id : d.id, eventB: c.id < d.id ? d.id : c.id, resolvedBy: "owner" });
    expect(await notifyClashes(db, { log })).toBe(1);
    const [n] = await db.select().from(notifications);
    expect(n.title).toMatch(/^Clash on /);
    expect(n.body).toMatch(/^Soccer game \(\d\d:\d\d\) and Swim practice/);
    expect(n.target).toBe(`events/${a.id}`);
    expect(await notifyClashes(db, { log })).toBe(0);
    expect(b.id).toBeTruthy();
    // Leave the calendar as it was for the other tests.
    await db.delete(conflicts);
    await db.delete(events).where(eq(events.sourceId, src.id));
  });

  it("tells when he's accepted (once) and off the list, not other moves (TEN-10, ACC-6)", async () => {
    await register(await phone(), TOKEN_A);
    const entry = { id: crypto.randomUUID(), tournamentName: "Rookie Open", eventName: "U9 Orange" };
    await notifyEntryChange(db, { ...entry, status: "entered" }, "reserve", { log });
    await notifyEntryChange(db, { ...entry, status: "found" }, "entered", { log });
    expect(sent).toHaveLength(0);
    await notifyEntryChange(db, { ...entry, status: "entered" }, "main_draw", { log });
    // Once per entry: back from the reserve list says nothing new.
    await notifyEntryChange(db, { ...entry, status: "reserve" }, "main_draw", { log });
    await notifyEntryChange(db, { ...entry, status: "main_draw" }, "withdrawn", { log });
    const rows = await db.select().from(notifications);
    expect(rows.map((r) => r.title).sort()).toEqual([
      "Accepted: Rookie Open (U9 Orange)",
      "Off the entry list",
    ]);
    expect(rows.find((r) => r.title.startsWith("Accepted"))?.body).toBe("He's in the main draw.");
    expect(tennisEntries).toBeDefined();
  });

  it("says a source keeps failing at most once a day (SYNC-4, PUSH-5)", async () => {
    const source = { id: crypto.randomUUID(), name: "Club calendar" };
    await notifySyncFailed(db, source, "The site took too long.", { log });
    await notifySyncFailed(db, source, "The site took too long.", { log });
    expect(await db.select().from(notifications)).toHaveLength(1);
    const tomorrow = new Date(Date.now() + 86_400_000);
    await notifySyncFailed(db, source, "Still failing.", { log, now: tomorrow });
    expect(await db.select().from(notifications)).toHaveLength(2);
  });
});
