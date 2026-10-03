import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assistantActions,
  assistantTurns,
  eventOverrides,
  events,
  notifications,
  sources,
  users,
} from "@db/schema";
import type { GoogleEvent } from "@/adapters/google-calendar";
import { normaliseGoogle } from "@/adapters/google-calendar";
import { WriteFailed, type CalendarWriter, type NewGoogleEvent } from "@/adapters/google-calendar/writer";
import { ownersFor, parseMapping } from "@/domain/categories";
import { undoTurn } from "@/server/assistant/actions";
import { ask } from "@/server/assistant/ask";
import { scriptedAssistant, type ModelCall } from "@/server/assistant/model";
import { saveAssistantSettings } from "@/server/assistant/settings";
import { CHANGE_TOOLS, HUB_TOOLS } from "@/server/assistant/tools";
import { loadCalendar } from "@/server/calendar/load";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { addPerson, listPeople } from "@/server/people";
import { syncRecords } from "@/server/sync/apply";
import { runAssistantActions } from "@/worker/assistant-actions";

// Intent 0008, plan E2: the worker writes what Cookie added to the household
// Google Calendar, against a stand-in Google that records every call.

const CALENDAR = "household@example.test";
const now = new Date("2033-05-02T16:00:00Z");
// Google's event IDs, unique across every stand-in and every run.
const runId = Date.now().toString(36);
let n = 0;

type FakeGoogle = CalendarWriter & {
  events: Map<string, GoogleEvent & { tag: string }>;
  calls: string[];
  failures: number[];
};

function fakeGoogle(calendarId = CALENDAR): FakeGoogle {
  const events = new Map<string, GoogleEvent & { tag: string }>();
  const calls: string[] = [];
  const failures: number[] = [];
  const maybeFail = () => {
    const status = failures.shift();
    if (status) throw new WriteFailed(status, status === 429 || status >= 500);
  };
  return {
    calendarId,
    events,
    calls,
    failures,
    async findAdded(actionId) {
      calls.push(`find ${actionId}`);
      maybeFail();
      return [...events.values()].find((e) => e.tag === actionId) ?? null;
    },
    async add(actionId, body: NewGoogleEvent) {
      calls.push(`add ${body.summary}`);
      maybeFail();
      const id = `g${runId}-${++n}`;
      const event = {
        id,
        tag: actionId,
        status: "confirmed",
        summary: body.summary,
        location: body.location,
        htmlLink: `https://calendar.example/${id}`,
        start: "date" in body.start ? { date: body.start.date } : { dateTime: body.start.dateTime },
        end: "date" in body.end ? { date: body.end.date } : { dateTime: body.end.dateTime },
      };
      events.set(id, event);
      return event;
    },
    async remove(eventId) {
      calls.push(`remove ${eventId}`);
      maybeFail();
      events.delete(eventId);
    },
  };
}

describe("Cookie writes what she added to the family calendar (plan E2)", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let userId: string;
  let sourceId: string;
  let people: Awaited<ReturnType<typeof listPeople>>;
  const lines: { message: string; fields?: Record<string, unknown> }[] = [];
  const log = (message: string, fields?: Record<string, unknown>) => lines.push({ message, fields });
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  let clock = 0;

  // Asks Cookie to add an event, with a scripted model.
  const add = async (args: Record<string, unknown>, launched: string[][] = []) => {
    const call: ModelCall = {
      name: "calendar_add",
      args: { title: "dentist appointment", date: "2033-05-04", start: "18:00", ...args },
    };
    return ask(
      db,
      {
        model: scriptedAssistant((_req, round) =>
          round === 1
            ? [call]
            : [{ name: "answer", args: { heard: "q", language: "en", text: "Adding.", sources: ["hub"] } }],
        ),
        tools: [...HUB_TOOLS, ...CHANGE_TOOLS],
        now: new Date(now.getTime() + ++clock * 1000),
        log: () => {},
        launch: async (a) => {
          launched.push(a);
        },
      },
      { userId, text: "Add a dentist appointment" },
    );
  };
  const run = (google: FakeGoogle) =>
    runAssistantActions(db, {
      log,
      sleep,
      now: () => new Date(now.getTime() + 60_000),
      writerFor: async (_db, _cred, calendarId) => {
        expect(calendarId).toBe(CALENDAR);
        return google;
      },
      notifyDeps: { sender: { send: async () => ({ ok: true }) } as never, log: () => {} },
    });
  const actionOf = async (turnId: string) =>
    (await db.select().from(assistantActions).where(eq(assistantActions.turnId, turnId)))[0];
  const eventOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    [{ id: userId }] = await db
      .insert(users)
      .values({ email: "cookie-writer@example.test" })
      .onConflictDoUpdate({ target: users.email, set: { email: "cookie-writer@example.test" } })
      .returning();
    // Kept between runs (its events are history); found again or made once.
    const [kept] = await db
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.name, "Cookie writer household"));
    sourceId =
      kept?.id ??
      (
        await db
          .insert(sources)
          .values({
            kind: "google_calendar",
            name: "Cookie writer household",
            categoryMapping: { default: "other", rules: [{ match: "dentist", category: "other" }] },
            config: { calendarId: CALENDAR },
            enabled: false,
          })
          .returning({ id: sources.id })
      )[0].id;
    await saveAssistantSettings(db, { addCalendarSourceId: sourceId });
    // "Everyone" has to mean more than the calendar's default owner (the
    // primary person), as it does in a family: add a second person if
    // this database has only one.
    if ((await listPeople(db)).length < 2) await addPerson(db, "Cookie test sibling");
    people = await listPeople(db);
    // This account's chat starts empty, so "the latest turn" is this run's.
    await db.delete(assistantActions);
    await db.delete(assistantTurns).where(eq(assistantTurns.userId, userId));
  });

  afterAll(async () => {
    await saveAssistantSettings(db, { addCalendarSourceId: null });
    await db.delete(assistantActions);
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.sourceId, sourceId));
    await handle.close();
  });

  beforeEach(async () => {
    await db.delete(assistantActions);
    await db.execute(sql`delete from rate_limits where key like 'assistant:%'`);
    lines.length = 0;
    sleeps.length = 0;
  });

  it("writes the event to Google and makes the hub's event its record, so the next read adds no twin (GCW-4, GCW-5)", async () => {
    const launched: string[][] = [];
    const result = await add({ people: [people[0].name] }, launched);
    // The question started the worker (GCW-4).
    expect(launched).toEqual([["assistant:actions"]]);
    const google = fakeGoogle();
    expect(await run(google)).toMatchObject({ added: 1, failed: 0 });

    // What Google was sent: the title with the name in front, in UTC with the home zone named.
    const [written] = [...google.events.values()];
    expect(written.summary).toBe(`${people[0].name} dentist appointment`);
    expect(google.calls).toEqual([`find ${(await actionOf(result.turnId)).id}`, `add ${written.summary}`]);

    const action = await actionOf(result.turnId);
    expect(action).toMatchObject({ state: "done", googleCalendarId: CALENDAR, googleEventId: written.id });
    const event = await eventOf(action.eventId!);
    expect(event).toMatchObject({
      sourceId,
      externalId: written.id,
      title: written.summary,
      deletedAt: null,
    });
    expect(event.sourceUrl).toBe(written.htmlLink);
    expect(event.sourceHash).toBeTruthy();

    // The household sync reads the same event from Google: no change, no twin.
    const source = {
      id: sourceId,
      name: "Household",
      config: { calendarId: CALENDAR },
      mapping: parseMapping({ default: "other" }),
    };
    const batch = normaliseGoogle(
      {
        items: [...google.events.values()],
        timeMin: "2033-05-01T00:00:00Z",
        timeMax: "2033-06-01T00:00:00Z",
      },
      { source, credential: null, now, homeTimeZone: "America/Toronto" },
    );
    const records = batch.records.map((r) => ({
      ...r,
      ownerIds: ownersFor(r.title, source.mapping, people),
    }));
    const plan = await syncRecords(db, { sourceId }, records, { from: null, to: null }, { actor: "sync" });
    // (Events from earlier runs of this file may be cancelled; this one is untouched.)
    expect(plan.counts).toMatchObject({ added: 0, changed: 0 });
    expect(plan.unchanged).toContain(written.id);
    expect(plan.items.some((i) => "id" in i && i.id === event.id)).toBe(false);
    const copies = await db.select().from(events).where(eq(events.externalId, written.id));
    expect(copies).toHaveLength(1);

    // The answer's card now says it is on the family calendar.
    const turns = await import("@/server/assistant/turns").then((m) => m.listTurns(db, userId, { limit: 1 }));
    expect(turns.turns[0].did?.events[0]).toMatchObject({ state: "added" });
  });

  it("keeps the people she was asked for when the title alone would say otherwise (everyone)", async () => {
    const result = await add({ title: "family dinner", people: ["everyone"] });
    await run(fakeGoogle());
    const action = await actionOf(result.turnId);
    const [override] = await db
      .select()
      .from(eventOverrides)
      .where(eq(eventOverrides.eventId, action.eventId!));
    expect(override?.ownerIds?.sort()).toEqual(people.map((p) => p.id).sort());
    const day = await loadCalendar(db, new Date("2033-05-04T00:00:00Z"), new Date("2033-05-06T00:00:00Z"));
    const dinner = day.events.find((e) => e.id === action.eventId);
    expect(dinner?.owners.sort()).toEqual(people.map((p) => p.id).sort());
  });

  it("tries again when Google is busy, and adds it once (GCW-7)", async () => {
    const result = await add({ people: [people[0].name] });
    const google = fakeGoogle();
    google.failures.push(503);
    expect(await run(google)).toMatchObject({ added: 1 });
    expect(sleeps).toEqual([15_000]);
    expect(google.events.size).toBe(1);
    expect((await actionOf(result.turnId)).tries).toBe(1);
    // CASEC-6: the log has the status, not the event.
    expect(JSON.stringify(lines)).toContain("503");
    expect(JSON.stringify(lines)).not.toContain("dentist");
  });

  it("finds an event an earlier try added before its answer was lost, instead of adding it twice", async () => {
    const result = await add({ people: [people[0].name] });
    const action = await actionOf(result.turnId);
    const google = fakeGoogle();
    await google.add(action.id, {
      summary: `${people[0].name} dentist appointment`,
      start: { dateTime: "2033-05-04T22:00:00.000Z", timeZone: "UTC" },
      end: { dateTime: "2033-05-04T23:00:00.000Z", timeZone: "UTC" },
    });
    google.calls.length = 0;
    await run(google);
    expect(google.calls).toEqual([`find ${action.id}`]);
    expect(google.events.size).toBe(1);
    expect(await actionOf(result.turnId)).toMatchObject({
      state: "done",
      googleEventId: [...google.events.keys()][0],
    });
  });

  it("gives up when Google refuses: the hub doesn't keep it, and the family is told (GCW-7)", async () => {
    const result = await add({ people: [people[0].name] });
    const google = fakeGoogle();
    google.failures.push(403);
    expect(await run(google)).toMatchObject({ added: 0, failed: 1 });
    expect(sleeps).toEqual([]);
    const action = await actionOf(result.turnId);
    expect(action.state).toBe("failed");
    expect((await eventOf(action.eventId!)).deletedAt).not.toBeNull();
    const [note] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupKey, `cookie_add:${action.id}`));
    expect(note).toMatchObject({ kind: "sync_failed", title: "Couldn't add to the family calendar" });
    expect(note.target).toBe("calendar?date=2033-05-04");
    const turns = await import("@/server/assistant/turns").then((m) => m.listTurns(db, userId, { limit: 1 }));
    expect(turns.turns[0].did?.events[0]).toMatchObject({ state: "failed", id: null });
  });

  it("takes an event back out of Google when the parent undoes it after the write (ACT-3, GCW-2)", async () => {
    const result = await add({ people: [people[0].name] });
    const google = fakeGoogle();
    await run(google);
    const action = await actionOf(result.turnId);
    const launched: string[][] = [];
    const undone = await undoTurn(
      db,
      userId,
      result.turnId,
      new Date(now.getTime() + 2 * 60_000),
      async (a) => {
        launched.push(a);
      },
    );
    expect(undone.events[0]).toMatchObject({ state: "undone", id: null });
    expect(launched).toEqual([["assistant:actions"]]);
    // Out of the hub at once...
    expect((await eventOf(action.eventId!)).deletedAt).not.toBeNull();
    // ...and out of Google when the worker runs: only the event it added.
    google.calls.length = 0;
    expect(await run(google)).toMatchObject({ removed: 1 });
    expect(google.calls).toEqual([`remove ${action.googleEventId}`]);
    expect(google.events.size).toBe(0);
    expect((await actionOf(result.turnId)).state).toBe("undone");
  });

  it("never touches Google for an event undone before it was written", async () => {
    const result = await add({ people: [people[0].name] });
    await undoTurn(db, userId, result.turnId, new Date(now.getTime() + 60_000));
    const google = fakeGoogle();
    expect(await run(google)).toMatchObject({ added: 0, removed: 0 });
    expect(google.calls).toEqual([]);
  });

  it("deletes nothing in a calendar other than the one it added to (GCW-2, CASEC-3)", async () => {
    const result = await add({ people: [people[0].name] });
    await run(fakeGoogle());
    const action = await actionOf(result.turnId);
    // Recorded against another calendar: the writer for this one leaves it alone.
    await db
      .update(assistantActions)
      .set({ googleCalendarId: "someone-else@example.test", undoneAt: now })
      .where(eq(assistantActions.id, action.id));
    const google = fakeGoogle();
    await run(google);
    expect(google.calls).toEqual([]);
  });
});
