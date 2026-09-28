import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, sources } from "@db/schema";
import { loadSchoolDay } from "@/server/calendar/school-day";
import { createCredential } from "@/server/credentials/store";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createLogger, forgetSecrets } from "@/server/log";
import { setHomeTimeZone } from "@/server/settings";
import { syncSource } from "@/worker/sync";
import {
  createFakeVeracross,
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
    return server as Server & { requested: string[] };
  }

  async function newSource(config: Record<string, string>, password = FAKE_VERACROSS_LOGIN.password) {
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
    return s.id;
  }

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    await setHomeTimeZone(db, "America/Toronto");
    process.env.SYNC_MIN_GAP_MINUTES = "0";
    process.env.FETCH_MIN_GAP_MS = "0";
  });
  afterAll(async () => {
    for (const s of servers) s.close();
    delete process.env.VERACROSS_BASE_URL;
    delete process.env.SYNC_MIN_GAP_MINUTES;
    delete process.env.FETCH_MIN_GAP_MS;
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
    expect(lines.join("\n")).toContain("asks for a sign-in code");
  }, 90_000);
});
