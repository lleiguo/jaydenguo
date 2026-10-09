import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { credentials, sources, tennisEntries } from "@db/schema";
import { TcLoginError, tcRegistrarClient } from "@/adapters/tennis-tc/registrar";
import { aadFor } from "@/server/credentials/aad";
import { seal } from "@/server/crypto/envelope";
import { defaultKeyWrapper } from "@/server/crypto/key-wrapper";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createLogger } from "@/server/log";
import { runEnter } from "@/server/tennis/entries";
import { syncSource } from "@/worker/sync";
import { checkCredential } from "@/worker/credentials";
import { tennisRegistrar } from "@/worker/tennis-registrar";
import {
  createFakeTc,
  ENTRY_FIXTURE,
  TC_LOGIN,
  TC_NOW,
  TC_PROFILE_URL,
  type EntrySubmission,
} from "../e2e/support/fake-tc";

// Entering him on the site (plan M3b.6, TEN-9) against the fake site's
// signed-in pages: sign in, fill the one-page form, agree, submit, and read
// what the site shows next.

describe("tennis registrar", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let base = "";
  const submissions: EntrySubmission[] = [];
  const paid = new Set<string>();
  const log = createLogger((l) => process.env.DEBUG_LOG && console.log(l));
  const credIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    process.env.SYNC_MIN_GAP_MINUTES = "0";
    process.env.FETCH_MIN_GAP_MS = "0";
    server = createFakeTc({ submissions, paid });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.TENNIS_TC_BASE_URL = base;
  });
  afterAll(async () => {
    delete process.env.TENNIS_TC_BASE_URL;
    for (const id of credIds) await db.delete(credentials).where(eq(credentials.id, id));
    await new Promise((r) => server.close(r));
    await handle.close();
  });

  const client = () => tcRegistrarClient(base, TC_LOGIN.username, TC_LOGIN.password);

  it("signs in, picks his event, agrees and submits; the site shows him entered", async () => {
    submissions.length = 0;
    const c = client();
    const outcome = await c.enter({ tournamentId: ENTRY_FIXTURE.a, eventName: "U9 Orange Boys" });
    expect(outcome).toEqual({ result: "entered", note: "Entered in BU9 - Orange. Fee $30.00." });
    expect(submissions).toEqual([{ tournament: ENTRY_FIXTURE.a, eventId: "9006", agreed: true }]);
    // Asking again reads "My entry" and submits nothing.
    expect(await c.enter({ tournamentId: ENTRY_FIXTURE.a, eventName: "U9 Orange Boys" })).toEqual({
      result: "entered",
      note: "Already entered on the site.",
    });
    expect(submissions).toHaveLength(1);
  });

  it("doesn't enter again when he was entered by hand (the entry page shows the form again)", async () => {
    const handEntered = new Map([[ENTRY_FIXTURE.b, { eventNo: "3", event: "U10 Orange" }]]);
    const own: EntrySubmission[] = [];
    const site = createFakeTc({ submissions: own, handEntered });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
    try {
      const at = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
      const c = tcRegistrarClient(at, TC_LOGIN.username, TC_LOGIN.password);
      expect(await c.enter({ tournamentId: ENTRY_FIXTURE.b, eventName: "U10 Orange" })).toEqual({
        result: "entered",
        note: "Already entered on the site.",
      });
      expect(own).toEqual([]);
      expect(await c.myEntries()).toEqual([
        {
          tournamentId: ENTRY_FIXTURE.b,
          name: "Fixture Fall Classic",
          venue: "Fixture Tennis Club",
          city: "Nearby",
          date: "2024-10-05",
          events: [{ eventNo: "3", name: "U10 Orange" }],
          status: "entered",
        },
        expect.objectContaining({ name: "Fixture Withdrawn Open", status: "not_entered" }),
        expect.objectContaining({ name: "Fixture Summer Open", status: "entered" }),
      ]);
    } finally {
      await new Promise((r) => site.close(r));
    }
  });

  it("flags an entry the site asks payment for", async () => {
    paid.add(ENTRY_FIXTURE.b);
    try {
      const outcome = await client().enter({ tournamentId: ENTRY_FIXTURE.b, eventName: "U10 Orange" });
      expect(outcome.result).toBe("payment_needed");
      expect(outcome.note).toMatch(/^Payment required\. Fee \$45\.00\./);
    } finally {
      paid.delete(ENTRY_FIXTURE.b);
    }
  });

  it("leaves it to the owner when the event isn't clear, and submits nothing", async () => {
    submissions.length = 0;
    const outcome = await client().enter({ tournamentId: ENTRY_FIXTURE.b, eventName: "U12 Green" });
    expect(outcome.result).toBe("unavailable");
    expect(outcome.note).toContain("BS10 - Orange $45.00");
    expect(submissions).toEqual([]);
  });

  it("says so when the login is wrong", async () => {
    await expect(
      tcRegistrarClient(base, TC_LOGIN.username, "wrong").enter({
        tournamentId: ENTRY_FIXTURE.a,
        eventName: "U9 Orange Boys",
      }),
    ).rejects.toThrow(
      new TcLoginError(
        'Tennis Canada sign-in failed ("Invalid login or password"): check the login on the Accounts page.',
      ),
    );
  });

  it("Test connection signs in and reads his entries", async () => {
    const cred = (password: string) => ({
      id: "t",
      kind: "password",
      provider: "tennis_tc",
      username: TC_LOGIN.username,
      secret: password,
    });
    expect(await checkCredential(cred(TC_LOGIN.password))).toBeNull();
    expect(await checkCredential(cred("wrong"))).toBe(
      'Tennis Canada sign-in failed ("Invalid login or password"): check the login on the Accounts page.',
    );
  });

  it("Thursday: with a stored login, the job enters him and records it", async () => {
    // A fresh fake, so tournament A isn't entered yet.
    const fresh = createFakeTc({ submissions: [] });
    await new Promise<void>((r) => fresh.listen(0, "127.0.0.1", r));
    const freshBase = `http://127.0.0.1:${(fresh.address() as AddressInfo).port}`;
    process.env.TENNIS_TC_BASE_URL = freshBase;
    try {
      const id = randomUUID();
      credIds.push(id);
      await db.insert(credentials).values({
        id,
        kind: "password",
        provider: "tennis_tc",
        label: "Tennis Canada (test)",
        username: TC_LOGIN.username,
        ...(await seal(defaultKeyWrapper(), TC_LOGIN.password, aadFor(id))),
      });
      const [s] = await db
        .insert(sources)
        .values({
          kind: "tennis_tc",
          name: "Tennis",
          config: { profileUrl: TC_PROFILE_URL(freshBase), entry: { homePostalCode: "A1A 1A1" } },
          categoryMapping: { default: "tennis" },
        })
        .returning();
      expect((await syncSource(db, s.id, "manual", log, () => TC_NOW)).status).toBe("succeeded");
      const registrar = await tennisRegistrar(db, s, log);
      const drive = async (_from: string, to: string) => (to.includes("Faraway") ? 100 : 30);
      const result = await runEnter({ db, log, now: TC_NOW, timeZone: "America/Toronto" }, s, {
        drive,
        registrar,
      });
      expect(result).toMatchObject({ entered: 1, left: 0 });
      // The sync's own entry refresh may have recorded others (e.g. skipped).
      const [a] = await db
        .select()
        .from(tennisEntries)
        .where(
          and(eq(tennisEntries.sourceId, s.id), eq(tennisEntries.tournamentExternalId, ENTRY_FIXTURE.a)),
        );
      expect(a).toMatchObject({ tournamentExternalId: ENTRY_FIXTURE.a, status: "entered" });
      expect(a.note).toContain("Entered in BU9 - Orange");

      // His account's "My entries" has it.
      const statusOf = async (r: typeof registrar, t: string) =>
        (await r.myEntries!())?.find((m) => m.tournamentId === t)?.status ?? "not_entered";
      expect(await statusOf(registrar, ENTRY_FIXTURE.a)).toBe("entered");
      expect(await statusOf(registrar, ENTRY_FIXTURE.b)).toBe("not_entered");

      // Switched off on the source: the job leaves entries to the owner.
      const off = await tennisRegistrar(db, { config: { entry: { autoEnter: false } } }, log);
      expect(
        await off.enter({ tournamentId: ENTRY_FIXTURE.a, eventNo: "6", eventName: "U9 Orange Boys" }),
      ).toEqual({
        result: "unavailable",
      });
      // Reading still works with automatic entry off.
      expect(await statusOf(off, ENTRY_FIXTURE.a)).toBe("entered");
    } finally {
      process.env.TENNIS_TC_BASE_URL = base;
      await new Promise((r) => fresh.close(r));
    }
  });
});
