import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { calendarCopyEvents, events as hubEvents, sources } from "@db/schema";
import { googleAccessToken, googleApiBase } from "../adapters/google-calendar";
import { USER_AGENT } from "../adapters/http";
import { SyncError } from "../adapters/types";
import {
  bodyHash,
  COPY_CALENDAR_NAME,
  googleEventBody,
  planCopy,
  type GoogleEventBody,
} from "../domain/calendar-copy";
import { loadCalendar } from "../server/calendar/load";
import { getCopySettings, saveCopySettings } from "../server/calendar-copy";
import type { Db } from "../server/db/client";
import { registerSecret } from "../server/log";
import { getHomeTimeZone } from "../server/settings";
import type { JobContext } from "./context";
import { openCredential } from "./credentials";

// `calendar:copy`: one-way copy to the "Jayden (hub)" Google Calendar
// (plan M5.9, GCO-1): creates the calendar on first use, then creates,
// changes and deletes Google events so the copy matches the calendar from
// 30 days back to a year ahead. `calendar:copy delete` deletes the copy
// after it was switched off (GCO-2). Runs after the daily sync, when the
// copy is switched on, and on "Copy now".

const PAST_DAYS = 30;
const FUTURE_DAYS = 366;
const GAP_MS = () => Number(process.env.CALENDAR_COPY_GAP_MS ?? 120);

export class CopyError extends SyncError {}

type Api = <T>(method: string, path: string, body?: unknown) => Promise<{ status: number; data: T }>;

function calendarApi(token: string): Api {
  let last = 0;
  return async (method, path, body) => {
    const wait = last + GAP_MS() - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    let res: Response;
    try {
      res = await fetch(new URL(`/calendar/v3/${path}`, googleApiBase()), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": USER_AGENT,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new CopyError("Couldn't reach Google Calendar. It will be tried again next time.");
    }
    if (res.status === 401 || res.status === 403)
      throw new CopyError("Google Calendar refused. Reconnect the calendar copy's Google account.");
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as never };
  };
}

// GCO-1: every write goes to the calendar the site created, and never to a
// calendar that is a source (the household calendar) or "primary".
async function guard(db: Db, calendarId: string) {
  const rows = await db
    .select({ config: sources.config })
    .from(sources)
    .where(eq(sources.kind, "google_calendar"));
  const sourceCalendars = new Set(rows.map((r) => (r.config as { calendarId?: string }).calendarId));
  if (calendarId === "primary" || sourceCalendars.has(calendarId))
    throw new CopyError("The copy would write to a calendar the site reads from. Stopped.");
}

async function ensureCalendar(db: Db, api: Api, calendarId: string | null, timeZone: string) {
  if (calendarId) {
    const got = await api("GET", `calendars/${encodeURIComponent(calendarId)}`);
    if (got.status === 200) return calendarId;
    if (got.status !== 404 && got.status !== 410)
      throw new CopyError(`Google Calendar answered with an error (${got.status}).`);
  }
  const created = await api<{ id: string }>("POST", "calendars", {
    summary: COPY_CALENDAR_NAME,
    description: "A copy of Jayden's family hub calendar. Changes made here are overwritten.",
    timeZone,
  });
  if (created.status !== 200 || !created.data?.id)
    throw new CopyError(`Couldn't create the "${COPY_CALENDAR_NAME}" calendar (${created.status}).`);
  // Mappings to an old calendar don't carry over.
  await db.delete(calendarCopyEvents);
  await saveCopySettings(db, { calendarId: created.data.id });
  return created.data.id;
}

async function token(db: Db, credentialId: string) {
  const cred = await openCredential(db, credentialId, "calendar copy");
  const t = await googleAccessToken(cred.secret);
  registerSecret(t);
  return t;
}

export async function copyCalendar(db: Db, now = new Date()) {
  const settings = await getCopySettings(db);
  if (!settings.enabled || !settings.credentialId) return { skipped: "switched off" as const };
  const timeZone = await getHomeTimeZone(db);
  const api = calendarApi(await token(db, settings.credentialId));
  const calendarId = await ensureCalendar(db, api, settings.calendarId, timeZone);
  await guard(db, calendarId);
  const cal = encodeURIComponent(calendarId);

  const { events } = await loadCalendar(
    db,
    new Date(now.getTime() - PAST_DAYS * 86_400_000),
    new Date(now.getTime() + FUTURE_DAYS * 86_400_000),
  );
  const desired = events
    .filter((e) => e.status === "active" && !e.deletedAt && !e.override?.skip)
    .map((e) => {
      const body: GoogleEventBody = googleEventBody(e, timeZone);
      return { eventId: e.id, body, hash: bodyHash(body) };
    });
  const existing = await db
    .select()
    .from(calendarCopyEvents)
    .where(eq(calendarCopyEvents.calendarId, calendarId));
  // Copies of events in the range, or deleted since, are compared; older
  // events stay in the copy as they were.
  const inRange = new Set(events.map((e) => e.id));
  const ids = existing.map((m) => m.eventId);
  const deletedIds = new Set(
    ids.length
      ? (
          await db
            .select({ id: hubEvents.id })
            .from(hubEvents)
            .where(and(inArray(hubEvents.id, ids), isNotNull(hubEvents.deletedAt)))
        ).map((r) => r.id)
      : [],
  );
  const plan = planCopy(
    desired,
    existing.filter((m) => inRange.has(m.eventId) || deletedIds.has(m.eventId)),
  );

  let created = 0;
  let updated = 0;
  let deleted = 0;
  for (const d of plan.create) {
    const r = await api<{ id: string }>("POST", `calendars/${cal}/events`, d.body);
    if (r.status !== 200) throw new CopyError(`Couldn't add an event to the copy (${r.status}).`);
    await db
      .insert(calendarCopyEvents)
      .values({ eventId: d.eventId, calendarId, googleEventId: r.data.id, hash: d.hash })
      .onConflictDoUpdate({
        target: calendarCopyEvents.eventId,
        set: { calendarId, googleEventId: r.data.id, hash: d.hash, updatedAt: new Date() },
      });
    created++;
  }
  for (const d of plan.update) {
    const r = await api("PUT", `calendars/${cal}/events/${encodeURIComponent(d.googleEventId)}`, d.body);
    if (r.status === 404 || r.status === 410) {
      // Deleted in Google Calendar by hand: add it again.
      const again = await api<{ id: string }>("POST", `calendars/${cal}/events`, d.body);
      if (again.status !== 200) throw new CopyError(`Couldn't add an event to the copy (${again.status}).`);
      d.googleEventId = again.data.id;
    } else if (r.status !== 200) throw new CopyError(`Couldn't change an event in the copy (${r.status}).`);
    await db
      .update(calendarCopyEvents)
      .set({ googleEventId: d.googleEventId, hash: d.hash, updatedAt: new Date() })
      .where(eq(calendarCopyEvents.eventId, d.eventId));
    updated++;
  }
  for (const m of plan.remove) {
    const r = await api("DELETE", `calendars/${cal}/events/${encodeURIComponent(m.googleEventId)}`);
    if (![200, 204, 404, 410].includes(r.status))
      throw new CopyError(`Couldn't remove an event from the copy (${r.status}).`);
    await db
      .delete(calendarCopyEvents)
      .where(and(eq(calendarCopyEvents.eventId, m.eventId), eq(calendarCopyEvents.calendarId, calendarId)));
    deleted++;
  }
  return { created, updated, deleted };
}

export async function deleteCopy(db: Db) {
  const settings = await getCopySettings(db);
  if (settings.enabled || !settings.calendarId || !settings.credentialId)
    return { skipped: "nothing to delete" };
  const api = calendarApi(await token(db, settings.credentialId));
  await guard(db, settings.calendarId);
  const r = await api("DELETE", `calendars/${encodeURIComponent(settings.calendarId)}`);
  if (![200, 204, 404, 410].includes(r.status))
    throw new CopyError(`Couldn't delete the copy calendar (${r.status}).`);
  await db.delete(calendarCopyEvents);
  await saveCopySettings(db, { calendarId: null });
  return { deleted: true };
}

export async function calendarCopyJob(args: string[], ctx: JobContext) {
  const db = await ctx.db();
  try {
    const result = args[0] === "delete" ? await deleteCopy(db) : await copyCalendar(db);
    await saveCopySettings(db, {
      lastRunAt: new Date().toISOString(),
      lastError: null,
      ...("created" in result ? { last: result } : {}),
    });
    ctx.log("calendar copy", result);
  } catch (err) {
    const message =
      err instanceof SyncError
        ? err.message
        : "The calendar copy failed unexpectedly. It will be tried again.";
    await saveCopySettings(db, { lastRunAt: new Date().toISOString(), lastError: message });
    ctx.log("calendar copy failed", { error: err }, "WARNING");
  }
}
