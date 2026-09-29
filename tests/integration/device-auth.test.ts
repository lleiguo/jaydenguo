import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authCodes, rateLimits, sessions } from "@db/schema";
import { exchangeDeviceCode, openHandoff, startHandoff } from "@/server/auth/device";
import {
  createSession,
  findSession,
  issueCode,
  listSessions,
  revokeAllSessions,
  takeDeviceCode,
} from "@/server/auth/session";
import { pkceChallenge, sessionIdFor } from "@/server/auth/tokens";
import { authSecret } from "@/server/config";
import { HttpError } from "@/server/errors";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

// intent 0004, API-1, API-2, API-5 and spec N-6.

const OWNER = "owner@example.test";
const verifier = "v".repeat(43);
const challenge = pkceChallenge(verifier);

describe("device sign-in", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;

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
    await db.delete(rateLimits);
  });

  const deviceCode = () =>
    issueCode(db, { email: OWNER }, { purpose: "device", challenge, deviceName: "Test iPhone" });

  it("swaps a code and the right verifier for a device token, once", async () => {
    const code = await deviceCode();
    // Only a hash of the code is stored.
    expect(await db.select().from(authCodes).where(eq(authCodes.id, code))).toHaveLength(0);
    const { token } = await exchangeDeviceCode(db, { code, verifier }, "1.2.3.4", "HubApp/1");
    const session = await findSession(db, token);
    expect(session).toMatchObject({ email: OWNER, kind: "device" });
    const [row] = await db.select().from(sessions).where(eq(sessions.id, session!.sessionId));
    expect(row.deviceName).toBe("Test iPhone");
    await expect(exchangeDeviceCode(db, { code, verifier }, "1.2.3.4", null)).rejects.toThrow(HttpError);
  });

  it("refuses a wrong verifier, and the code is gone afterwards", async () => {
    const code = await deviceCode();
    await expect(exchangeDeviceCode(db, { code, verifier: "w".repeat(43) }, "1.2.3.4", null)).rejects.toThrow(
      "Sign-in didn't finish",
    );
    await expect(exchangeDeviceCode(db, { code, verifier }, "1.2.3.4", null)).rejects.toThrow(HttpError);
  });

  it("refuses an expired code or one for another purpose", async () => {
    const code = await deviceCode();
    await db
      .update(authCodes)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(authCodes.id, sessionIdFor(code, authSecret())));
    expect(await takeDeviceCode(db, code)).toBeNull();
    const handoff = await issueCode(
      db,
      { email: OWNER },
      { purpose: "handoff", returnTo: "/accounts/google/connect" },
    );
    expect(await takeDeviceCode(db, handoff)).toBeNull();
  });

  it("refuses a code once the account leaves the allow-list", async () => {
    const code = await deviceCode();
    process.env.ALLOWED_EMAILS = "someone-else@example.test";
    try {
      expect(await takeDeviceCode(db, code)).toBeNull();
    } finally {
      process.env.ALLOWED_EMAILS = OWNER;
    }
  });

  it("rate-limits the exchange per address", async () => {
    for (let i = 0; i < 20; i++) {
      await exchangeDeviceCode(db, { code: "x".repeat(43), verifier }, "5.6.7.8", null).catch(() => {});
    }
    await expect(
      exchangeDeviceCode(db, { code: await deviceCode(), verifier }, "5.6.7.8", null),
    ).rejects.toThrow("Too many tries");
  });

  it("keeps a device token valid 30 days after its last use (N-6)", async () => {
    const { token } = await createSession(db, OWNER, null, { kind: "device" });
    const found = await findSession(db, token);
    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now() - interval '10 days'`, expiresAt: sql`now() + interval '1 day'` })
      .where(eq(sessions.id, found!.sessionId));
    await findSession(db, token);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, found!.sessionId));
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it("doesn't extend a browser session", async () => {
    const { token, expiresAt } = await createSession(db, OWNER, null);
    const found = await findSession(db, token);
    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now() - interval '10 days'` })
      .where(eq(sessions.id, found!.sessionId));
    await findSession(db, token);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, found!.sessionId));
    expect(row.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it("lists devices with their kind and name, and sign out everywhere ends them", async () => {
    const browser = await createSession(db, OWNER, "Firefox");
    const device = await createSession(db, OWNER, "HubApp/1", { kind: "device", deviceName: "Lei's iPhone" });
    const me = (await findSession(db, browser.token))!;
    const list = await listSessions(db, me);
    expect(list).toContainEqual(
      expect.objectContaining({ kind: "device", deviceName: "Lei's iPhone", current: false }),
    );
    expect(list).toContainEqual(expect.objectContaining({ kind: "browser", current: true }));
    await revokeAllSessions(db, me);
    expect(await findSession(db, device.token)).toBeNull();
  });
});

describe("web handoff", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;

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

  it("opens once, with an hour-long web session, where the app asked", async () => {
    const { token } = await createSession(db, OWNER, null, { kind: "device" });
    const me = (await findSession(db, token))!;
    const next = "/accounts/google/connect?feature=drive&next=/auth/app-done";
    const { url } = await startHandoff(db, me, { next }, "https://hub.example");
    expect(url).toMatch(/^https:\/\/hub\.example\/auth\/handoff\?code=[A-Za-z0-9_-]{43}$/);
    const code = new URL(url).searchParams.get("code");
    const opened = await openHandoff(db, code, "Safari");
    expect(opened?.returnTo).toBe(next);
    expect(opened!.expiresAt.getTime()).toBeLessThan(Date.now() + 61 * 60_000);
    expect(await findSession(db, opened!.token)).toMatchObject({ kind: "handoff" });
    expect(await openHandoff(db, code, "Safari")).toBeNull();
  });
});
