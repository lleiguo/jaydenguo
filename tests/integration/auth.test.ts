import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rateLimits, sessions } from "@db/schema";
import { allowLoginAttempt, hit } from "@/server/auth/rate-limit";
import { createSession, findSession, revokeAllSessions, startLogin, takeLogin } from "@/server/auth/session";
import { sessionIdFor } from "@/server/auth/tokens";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

const OWNER = "owner@example.test";

describe("sessions", () => {
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

  it("finds a live session and stores only a hash of the token", async () => {
    const { token } = await createSession(db, "Owner@Example.test", null);
    const found = await findSession(db, token);
    expect(found?.email).toBe(OWNER);
    const rows = await db.select().from(sessions).where(eq(sessions.id, token));
    expect(rows).toHaveLength(0);
  });

  it("refuses to create a session for an account not on the allow-list", async () => {
    await expect(createSession(db, "intruder@example.test", null)).rejects.toThrow();
  });

  it("stops accepting a session once its user leaves the allow-list", async () => {
    const { token } = await createSession(db, OWNER, null);
    process.env.ALLOWED_EMAILS = "someone-else@example.test";
    expect(await findSession(db, token)).toBeNull();
    process.env.ALLOWED_EMAILS = OWNER;
    expect(await findSession(db, token)).not.toBeNull();
  });

  it("rejects expired sessions", async () => {
    const { token } = await createSession(db, OWNER, null);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, sessionIdFor(token, "dev-only-auth-secret-not-for-production")));
    expect(await findSession(db, token)).toBeNull();
  });

  it("sign out everywhere revokes every session of the user", async () => {
    const a = await createSession(db, OWNER, null);
    const b = await createSession(db, OWNER, null);
    const session = (await findSession(db, a.token))!;
    expect(await revokeAllSessions(db, session)).toBeGreaterThanOrEqual(2);
    expect(await findSession(db, a.token)).toBeNull();
    expect(await findSession(db, b.token)).toBeNull();
  });

  it("a pre-login session can be used once and never counts as signed in", async () => {
    const state = { state: "s", nonce: "n", codeVerifier: "v", returnTo: "/" };
    const token = await startLogin(db, state, null);
    expect(await findSession(db, token)).toBeNull();
    expect(await takeLogin(db, token)).toEqual(state);
    expect(await takeLogin(db, token)).toBeNull();
  });

  it("rate-limits sign-in attempts per address", async () => {
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await allowLoginAttempt(db, "203.0.113.9"));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await allowLoginAttempt(db, "203.0.113.10")).toBe(true);
  });

  it("counts in fixed windows", async () => {
    expect(await hit(db, "k", 1, 60_000)).toBe(true);
    expect(await hit(db, "k", 1, 60_000)).toBe(false);
  });
});
