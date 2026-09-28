import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { credentialSessions, credentials, events, sources } from "@db/schema";
import { loadSchoolDay } from "@/server/calendar/school-day";
import { createCredential, submitSignInCode } from "@/server/credentials/store";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createLogger, forgetSecrets } from "@/server/log";
import { setHomeTimeZone } from "@/server/settings";
import { testCredentialJob } from "@/worker/credentials";
import { syncSource } from "@/worker/sync";
import {
  createFakeVeracross,
  FAKE_VERACROSS_CODE,
  FAKE_VERACROSS_LOGIN,
  OTHER_STUDENT,
  OUR_STUDENT,
  SCHOOL,
} from "../e2e/support/fake-veracross";

// Plan M4.2: the Veracross adapter end to end, through real Chromium against
// a fake portal (generic two-step sign-in), into Postgres, and out through
// "Today at school".

describe("Veracross sync", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  const servers: Server[] = [];
  const lines: string[] = [];
  const log = createLogger((l) => lines.push(l));
  // Monday 2030-09-09, 7 am in Toronto (the tests' home time zone).
  const now = () => new Date("2030-09-09T11:00:00Z");

  async function fakeSite(opts: Parameters<typeof createFakeVeracross>[0] = {}) {
    const server = createFakeVeracross(opts);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    process.env.VERACROSS_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return server;
  }

  async function newSource(config: Record<string, string>, password = FAKE_VERACROSS_LOGIN.password) {
    return (await newSourceWithCredential(config, password)).sourceId;
  }

  async function newSourceWithCredential(
    config: Record<string, string>,
    password = FAKE_VERACROSS_LOGIN.password,
  ) {
    const cred = await createCredential(db, "test", {
      kind: "password",
      provider: "veracross",
      label: "Veracross",
      username: FAKE_VERACROSS_LOGIN.username,
      secret: password,
    });
    const [s] = await db
      .insert(sources)
      .values({
        kind: "veracross",
        name: "School",
        credentialId: cred.id,
        config: { portalUrl: `https://portals.veracross.com/${SCHOOL}/parent`, ...config },
        categoryMapping: { default: "school_class" },
      })
      .returning();
    return { sourceId: s.id, credentialId: cred.id };
  }

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    await setHomeTimeZone(db, "America/Toronto");
    process.env.SYNC_MIN_GAP_MINUTES = "0";
  });
  afterAll(async () => {
    for (const s of servers) s.close();
    delete process.env.VERACROSS_BASE_URL;
    delete process.env.SYNC_MIN_GAP_MINUTES;
    await handle.close();
  });
  beforeEach(() => {
    lines.length = 0;
    forgetSecrets();
  });

  it("signs in, reads his two weeks of school days, and feeds Today at school", async () => {
    // Wednesday has no classes (e.g. a Pro-D day).
    const site = await fakeSite({ noClasses: ["2030-09-11"] });
    const id = await newSource({ studentFirstName: "kid" });
    const result = await syncSource(db, id, "manual", log, now);
    // Ten weekdays, one without classes, seven periods each.
    expect(result).toEqual({ status: "succeeded", added: 63, changed: 0, cancelled: 0 });

    const rows = await db.select().from(events).where(eq(events.sourceId, id));
    expect(rows.every((e) => e.category === "school_class" && !e.allDay)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("Sibling-only class");
    expect(site.requested.some((p) => p.includes(OTHER_STUDENT.id))).toBe(false);
    expect(
      site.requested.filter((p) => p.includes(`/student/${OUR_STUDENT.id}/daily-schedule`)),
    ).toHaveLength(10);
    expect(lines.join("\n")).not.toContain(FAKE_VERACROSS_LOGIN.password);

    const day = await loadSchoolDay(db, now());
    expect(day).toMatchObject({ date: "2030-09-09", today: true });
    expect(day!.periods.map((p) => p.title)).toEqual([
      "Homeroom 4X",
      "Mathematics 4X",
      "Recess 4-7",
      "Science 4X",
      "Lunch 4-7",
      "French 4X",
      "Homeroom 4X",
    ]);
    expect(day!.periods[0]).toMatchObject({ room: "R101", teachers: "Alex Sample, Robin Example" });
    // After the last period, the card moves to the next school day.
    expect(await loadSchoolDay(db, new Date("2030-09-09T22:00:00Z"))).toMatchObject({
      date: "2030-09-10",
      today: false,
    });

    // A second run changes nothing (SYNC-3).
    expect(await syncSource(db, id, "manual", log, now)).toEqual({
      status: "succeeded",
      added: 0,
      changed: 0,
      cancelled: 0,
    });
    await db.update(sources).set({ enabled: false }).where(eq(sources.id, id));
  }, 90_000);

  it("asks which child when the login has more than one and no name is set", async () => {
    await fakeSite();
    const id = await newSource({});
    const result = await syncSource(db, id, "manual", log, now);
    expect(result.status).toBe("failed");
    const [s] = await db.select().from(sources).where(eq(sources.id, id));
    expect(s.consecutiveFailures).toBe(1);
    expect(lines.join("\n")).toContain("more than one student");
  }, 60_000);

  it("says plainly when the password is wrong or a code is needed", async () => {
    await fakeSite();
    await syncSource(db, await newSource({ studentFirstName: "Kid" }, "wrong"), "manual", log, now);
    expect(lines.join("\n")).toContain("Login failed: check the Veracross username and password");

    lines.length = 0;
    await fakeSite({ requireCode: true });
    await syncSource(db, await newSource({ studentFirstName: "Kid" }), "manual", log, now);
    expect(lines.join("\n")).toContain("Veracross needs a sign-in code");
  }, 90_000);

  it("takes the emailed code once through Test connection, then remembers the device", async () => {
    process.env.SIGNIN_CODE_WAIT_MS = "60000";
    const site = await fakeSite({ requireCode: true });
    const { sourceId, credentialId } = await newSourceWithCredential({ studentFirstName: "Kid" });
    const meta = async () =>
      (
        await db.select({ meta: credentials.meta }).from(credentials).where(eq(credentials.id, credentialId))
      )[0].meta as { codeRequestedAt?: string };

    // No code can be given before a sign-in waits for one.
    await expect(submitSignInCode(db, "owner", credentialId, FAKE_VERACROSS_CODE)).rejects.toThrow(
      /Test connection first/,
    );

    // "Test connection" signs in and waits; the owner types the code.
    const test = testCredentialJob([credentialId], { log, db: async () => db });
    await expect.poll(async () => (await meta()).codeRequestedAt, { timeout: 30_000 }).toBeTruthy();
    await submitSignInCode(db, "owner", credentialId, FAKE_VERACROSS_CODE);
    await test;
    const [cred] = await db.select().from(credentials).where(eq(credentials.id, credentialId));
    expect(cred).toMatchObject({ lastTestOk: true, lastError: null });
    expect((await meta()).codeRequestedAt).toBeUndefined();
    const extras = await db
      .select({ kind: credentialSessions.kind, ciphertext: credentialSessions.ciphertext })
      .from(credentialSessions)
      .where(eq(credentialSessions.credentialId, credentialId));
    // The code is gone; the cookies are kept, sealed.
    expect(extras.map((e) => e.kind)).toEqual(["browser"]);
    expect(extras[0].ciphertext.toString("utf8")).not.toContain("vcdevice");
    expect(lines.join("\n")).not.toContain(FAKE_VERACROSS_CODE);
    expect(site.codesSent).toBe(1);

    // A scheduled sync goes straight in on the saved session...
    expect(await syncSource(db, sourceId, "scheduled", log, now)).toMatchObject({ status: "succeeded" });
    // ...and once that session has expired, the remembered device skips the code.
    site.expireSessions();
    expect(await syncSource(db, sourceId, "scheduled", log, now)).toMatchObject({ status: "succeeded" });
    expect(site.codesSent).toBe(1);
    await db.update(sources).set({ enabled: false }).where(eq(sources.id, sourceId));
    delete process.env.SIGNIN_CODE_WAIT_MS;
  }, 120_000);

  it("types the code into one-digit boxes, ticks a styled checkbox and presses Verify", async () => {
    process.env.SIGNIN_CODE_WAIT_MS = "60000";
    const site = await fakeSite({ requireCode: true, codePage: "digits" });
    const { sourceId, credentialId } = await newSourceWithCredential({ studentFirstName: "Kid" });
    const test = testCredentialJob([credentialId], { log, db: async () => db });
    await expect
      .poll(
        async () =>
          (
            (await db.select().from(credentials).where(eq(credentials.id, credentialId)))[0].meta as {
              codeRequestedAt?: string;
            }
          ).codeRequestedAt,
        { timeout: 30_000 },
      )
      .toBeTruthy();
    await submitSignInCode(db, "owner", credentialId, FAKE_VERACROSS_CODE);
    await test;
    const [cred] = await db.select().from(credentials).where(eq(credentials.id, credentialId));
    expect(cred).toMatchObject({ lastTestOk: true, lastError: null });
    // Remembered: a fresh session needs no new code.
    site.expireSessions();
    expect(await syncSource(db, sourceId, "scheduled", log, now)).toMatchObject({ status: "succeeded" });
    expect(site.codesSent).toBe(1);
    await db.update(sources).set({ enabled: false }).where(eq(sources.id, sourceId));
    delete process.env.SIGNIN_CODE_WAIT_MS;
  }, 120_000);

  it("names the fields it saw when a code page isn't recognised, before asking for a code", async () => {
    await fakeSite({ requireCode: true, codePage: "unknown" });
    const { credentialId } = await newSourceWithCredential({ studentFirstName: "Kid" });
    await testCredentialJob([credentialId], { log, db: async () => db });
    const [cred] = await db.select().from(credentials).where(eq(credentials.id, credentialId));
    expect(cred.lastError).toBe(
      "Veracross's sign-in code page wasn't recognised, so this sync needs an update (fields seen: text name=a; text name=b).",
    );
    expect((cred.meta as { codeRequestedAt?: string }).codeRequestedAt).toBeUndefined();
  }, 60_000);

  it("says so when no code comes in time or the code is wrong", async () => {
    process.env.SIGNIN_CODE_WAIT_MS = "3000";
    await fakeSite({ requireCode: true });
    const { credentialId } = await newSourceWithCredential({ studentFirstName: "Kid" });
    await testCredentialJob([credentialId], { log, db: async () => db });
    let [cred] = await db.select().from(credentials).where(eq(credentials.id, credentialId));
    expect(cred.lastError).toContain("No sign-in code was entered in time");

    process.env.SIGNIN_CODE_WAIT_MS = "60000";
    const test = testCredentialJob([credentialId], { log, db: async () => db });
    await expect
      .poll(
        async () =>
          (
            (await db.select().from(credentials).where(eq(credentials.id, credentialId)))[0].meta as {
              codeRequestedAt?: string;
            }
          ).codeRequestedAt,
        { timeout: 30_000 },
      )
      .toBeTruthy();
    await submitSignInCode(db, "owner", credentialId, "000000");
    await test;
    [cred] = await db.select().from(credentials).where(eq(credentials.id, credentialId));
    expect(cred.lastError).toContain("didn't accept the code");
    delete process.env.SIGNIN_CODE_WAIT_MS;
  }, 120_000);
});
