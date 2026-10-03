import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { assistantActions, changeLog, credentials, events, sources } from "@db/schema";
import { googleAccessToken, normaliseGoogle, type GoogleEvent } from "../adapters/google-calendar";
import {
  WriteFailed,
  googleCalendarWriter,
  type CalendarWriter,
  type NewGoogleEvent,
} from "../adapters/google-calendar/writer";
import { ADD_SCOPE } from "../domain/assistant-changes";
import { ownersFor, parseMapping } from "../domain/categories";
import { resolveOwners } from "../domain/people";
import { localDate } from "../domain/time";
import { recordHash } from "../domain/upsert";
import { cookieActor } from "../server/assistant/actions";
import { setOwners } from "../server/calendar/mutations";
import type { Db } from "../server/db/client";
import type { Logger } from "../server/log";
import { listPeople } from "../server/people";
import { notify, type NotifyDeps } from "../server/push/notify";
import { getHomeTimeZone } from "../server/settings";
import type { JobContext } from "./context";
import { openCredential } from "./credentials";

// `assistant:actions` (intent 0008, GCW-2..7): writes what Cookie added to
// the household Google Calendar, and takes back what a parent undid. The
// web app records the change and starts this job; only the worker can open
// a Google grant (0001 CRED-4). The daily sync runs it too, to catch up.

export type ActionDeps = {
  log: Logger;
  now?: () => Date;
  // How to reach a calendar: the real Google, or a stand-in in tests.
  writerFor?: (db: Db, credentialId: string | null, calendarId: string) => Promise<CalendarWriter>;
  // Between tries when Google is busy (GCW-7).
  sleep?: (ms: number) => Promise<void>;
  notifyDeps?: NotifyDeps;
};

// Three tries over a little over a minute; then she gives up.
export const RETRY_DELAYS_MS = [15_000, 60_000];

class GiveUp extends Error {}

async function googleWriter(
  db: Db,
  credentialId: string | null,
  calendarId: string,
): Promise<CalendarWriter> {
  if (!credentialId) throw new GiveUp("the family calendar has no Google account connected");
  const [row] = await db
    .select({ scopes: credentials.scopes, status: credentials.status })
    .from(credentials)
    .where(eq(credentials.id, credentialId));
  if (!row || row.status !== "active" || !row.scopes?.includes(ADD_SCOPE))
    throw new GiveUp("the Google account can't add events; connect it again on the Accounts page");
  const cred = await openCredential(db, credentialId, "Cookie adds an event");
  return googleCalendarWriter(await googleAccessToken(cred.secret), calendarId);
}

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runAssistantActions(db: Db, deps: ActionDeps) {
  const now = deps.now ?? (() => new Date());
  const writerFor = deps.writerFor ?? googleWriter;
  const sleep = deps.sleep ?? sleepFor;
  const open = await db
    .select()
    .from(assistantActions)
    .where(
      and(
        eq(assistantActions.kind, "add_event"),
        or(
          eq(assistantActions.state, "pending"),
          and(eq(assistantActions.state, "done"), isNotNull(assistantActions.undoneAt)),
        ),
      ),
    )
    .orderBy(asc(assistantActions.createdAt));
  const counts = { added: 0, removed: 0, failed: 0, waiting: 0 };
  if (!open.length) return counts;

  const timeZone = await getHomeTimeZone(db);
  const people = await listPeople(db);
  const writers = new Map<string, CalendarWriter | GiveUp>();
  const writerOf = async (sourceId: string | null) => {
    const key = sourceId ?? "";
    if (!writers.has(key)) {
      try {
        const [source] = sourceId ? await db.select().from(sources).where(eq(sources.id, sourceId)) : [];
        const calendarId = (source?.config as { calendarId?: unknown } | undefined)?.calendarId;
        if (!source || source.kind !== "google_calendar" || typeof calendarId !== "string")
          throw new GiveUp("the family calendar she adds to is no longer set up");
        writers.set(key, await writerFor(db, source.credentialId, calendarId));
      } catch (err) {
        writers.set(key, err instanceof GiveUp ? err : new GiveUp("couldn't sign in to Google"));
        deps.log(
          "assistant actions: no writer",
          { sourceId, error: err instanceof GiveUp ? err.message : "sign-in" },
          "WARNING",
        );
      }
    }
    return writers.get(key)!;
  };

  for (const action of open) {
    const writer = await writerOf(action.sourceId);
    const undoing = action.state === "done";
    for (let attempt = 0; ; attempt++) {
      try {
        if (writer instanceof GiveUp) throw writer;
        if (undoing) await removeOne(db, writer, action.id);
        else await addOne(db, writer, action.id, { timeZone, people, now: now() });
        counts[undoing ? "removed" : "added"]++;
        break;
      } catch (err) {
        const retry = err instanceof WriteFailed && err.retry && attempt < RETRY_DELAYS_MS.length;
        // CASEC-6: the status, never the event.
        deps.log(
          "assistant action failed",
          { actionId: action.id, attempt, status: err instanceof WriteFailed ? err.status : undefined },
          "WARNING",
        );
        await db
          .update(assistantActions)
          .set({ tries: sql`${assistantActions.tries} + 1` })
          .where(eq(assistantActions.id, action.id));
        if (retry) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        if (err instanceof WriteFailed || err instanceof GiveUp) {
          // Taking back an event stays open: the next run tries again.
          if (undoing) counts.waiting++;
          else {
            await giveUp(db, action.id, err instanceof GiveUp ? err.message : null, deps);
            counts.failed++;
          }
          break;
        }
        throw err;
      }
    }
  }
  deps.log("assistant actions done", counts);
  return counts;
}

// GCW-4, GCW-5: write the event to Google and make the hub's event that
// Google event's record, under the lock the household sync takes, so the
// next read of Google matches it and no second copy appears.
async function addOne(
  db: Db,
  writer: CalendarWriter,
  actionId: string,
  ctx: { timeZone: string; people: Awaited<ReturnType<typeof listPeople>>; now: Date },
) {
  const intended = await db.transaction(async (tx) => {
    const [action] = await tx.select().from(assistantActions).where(eq(assistantActions.id, actionId));
    if (!action?.sourceId || action.state !== "pending") return null;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`source:${action.sourceId}`}))`);
    // Undone while waiting for the lock: nothing to write.
    const [again] = await tx
      .select({ state: assistantActions.state })
      .from(assistantActions)
      .where(eq(assistantActions.id, actionId))
      .for("update");
    if (again?.state !== "pending") return null;
    const [event] = await tx.select().from(events).where(eq(events.id, action.eventId!));
    const [source] = await tx.select().from(sources).where(eq(sources.id, action.sourceId));
    if (!event || event.deletedAt || !source) {
      await tx
        .update(assistantActions)
        .set({ state: "undone", undoneAt: ctx.now })
        .where(eq(assistantActions.id, actionId));
      return null;
    }

    const written =
      (await writer.findAdded(actionId)) ?? (await writer.add(actionId, googleBody(event, ctx.timeZone)));
    // Read back exactly as the household sync will read it.
    const mapping = parseMapping(source.categoryMapping);
    const record = recordOf(written, {
      source: { id: source.id, name: source.name, config: source.config as Record<string, unknown>, mapping },
      credential: null,
      now: ctx.now,
      homeTimeZone: ctx.timeZone,
    });
    const ownerIds = ownersFor(record.title, mapping, ctx.people);
    await tx
      .update(events)
      .set({
        sourceId: source.id,
        externalId: record.externalId,
        title: record.title,
        category: record.category,
        attendance: record.attendance,
        notes: record.notes,
        locationName: record.locationName,
        startUtc: record.startUtc,
        endUtc: record.endUtc,
        allDay: record.allDay,
        sourceUrl: record.sourceUrl,
        ownerIds,
        sourceHash: recordHash({ ...record, ownerIds }),
        updatedAt: ctx.now,
      })
      .where(eq(events.id, event.id));
    await tx.insert(changeLog).values({ kind: "event", refId: event.id });
    await tx
      .update(assistantActions)
      .set({
        state: "done",
        googleCalendarId: writer.calendarId,
        googleEventId: written.id,
        doneAt: ctx.now,
      })
      .where(eq(assistantActions.id, actionId));
    return { eventId: event.id, userId: action.userId, wanted: event.ownerIds, ownerIds };
  });
  // The people she was asked for stay its owners even where the title
  // alone would say otherwise ("everyone"): an override the sync keeps.
  if (intended) {
    const sameOwners =
      JSON.stringify(resolveOwners(intended.wanted, ctx.people).sort()) ===
      JSON.stringify(resolveOwners(intended.ownerIds, ctx.people).sort());
    if (!sameOwners)
      await setOwners(db, await cookieActor(db, intended.userId), intended.eventId, intended.wanted);
  }
}

function recordOf(written: GoogleEvent, ctx: Parameters<typeof normaliseGoogle>[1]) {
  const day = written.start.date ?? written.start.dateTime!.slice(0, 10);
  const [record] = normaliseGoogle(
    { items: [written], timeMin: `${day}T00:00:00Z`, timeMax: `${day}T00:00:00Z` },
    ctx,
  ).records;
  if (!record) throw new WriteFailed(0, false);
  return record;
}

// The event as Google wants it. An all-day event is the hub's day; a timed
// one is sent in UTC with the home time zone named, so it lands at the
// instant the parent said whatever Google's zone rules for that year are.
export function googleBody(
  event: { title: string; locationName: string | null; startUtc: Date; endUtc: Date; allDay: boolean },
  timeZone: string,
): NewGoogleEvent {
  if (event.allDay)
    return {
      summary: event.title,
      ...(event.locationName ? { location: event.locationName } : {}),
      start: { date: event.startUtc.toISOString().slice(0, 10) },
      end: { date: event.endUtc.toISOString().slice(0, 10) },
    };
  return {
    summary: event.title,
    ...(event.locationName ? { location: event.locationName } : {}),
    start: { dateTime: event.startUtc.toISOString(), timeZone },
    end: { dateTime: event.endUtc.toISOString(), timeZone },
  };
}

// ACT-3 after the write: only the Google event this action added.
async function removeOne(db: Db, writer: CalendarWriter, actionId: string) {
  const [action] = await db.select().from(assistantActions).where(eq(assistantActions.id, actionId));
  if (!action || action.state !== "done" || !action.undoneAt) return;
  // GCW-2: an event in this calendar, recorded as hers.
  if (action.googleEventId && action.googleCalendarId === writer.calendarId)
    await writer.remove(action.googleEventId);
  await db.update(assistantActions).set({ state: "undone" }).where(eq(assistantActions.id, actionId));
}

// GCW-7: the family calendar didn't take it, so the hub doesn't keep it.
async function giveUp(db: Db, actionId: string, why: string | null, deps: ActionDeps) {
  const [row] = await db
    .update(assistantActions)
    .set({ state: "failed" })
    .where(and(eq(assistantActions.id, actionId), eq(assistantActions.state, "pending")))
    .returning();
  if (!row?.eventId) return;
  const [event] = await db
    .update(events)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(events.id, row.eventId), isNull(events.sourceId), isNull(events.deletedAt)))
    .returning({ id: events.id, title: events.title, start: events.startUtc });
  if (!event) return;
  await db.insert(changeLog).values({ kind: "event", refId: event.id });
  const day = localDate(event.start, await getHomeTimeZone(db));
  await notify(
    db,
    {
      kind: "sync_failed",
      dedupKey: `cookie_add:${actionId}`,
      title: "Couldn't add to the family calendar",
      body: `"${event.title}" on ${day} wasn't added${why ? `: ${why}` : ": Google Calendar didn't take it"}. Ask Cookie again, or add it on the calendar.`,
      target: `calendar?date=${day}`,
    },
    deps.notifyDeps,
  );
}

export async function assistantActionsJob(_args: string[], ctx: JobContext) {
  const db = await ctx.db();
  await runAssistantActions(db, { log: ctx.log });
}
