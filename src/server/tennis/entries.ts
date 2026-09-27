import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { sources, tennisEntries, tennisPlayers } from "@db/schema";
import { Budget, TcClient, tennisBaseUrl } from "../../adapters/tennis-tc";
import {
  parseEventList,
  parseEventPage,
  parseSearchResults,
  type TcEventPage,
} from "../../adapters/tennis-tc/entry-parse";
import { parseBracket, parseDrawMatches, parseTournament } from "../../adapters/tennis-tc/parse";
import type { EntryStatus } from "../../domain/tennis-constants";
import {
  ACTIVE_ENTRY,
  chooseEntries,
  entryPrefsOf,
  fallbackRadiusKm,
  findSelfRow,
  pickEvent,
  searchRadiusKm,
  statusFromList,
  type EntryPrefs,
} from "../../domain/tennis-entry";
import { addDays, localDate } from "../../domain/time";
import type { Db, DbOrTx } from "../db/client";
import type { Logger } from "../log";
import type { DriveTimer } from "./drive";

// The tournament-entry jobs (TEN-9..11, plan M3b):
// - Thursday noon (`tennis:enter`): find Rookie tournaments open for entry
//   near home, pick his event (e.g. U9 orange), keep those within the
//   drive limit, one per weekend, and enter him, or list them with the
//   site's entry link for the owner.
// - Friday 10:00 (`tennis:acceptance`): read each event's entry list and
//   record main draw or reserve list (and place).
// - Monday, hourly (`tennis:draw-watch`): for tournaments in the coming
//   week, look for his draw; once it's out, run the full tennis sync, which
//   reads the draw, his opponents (one hop) and writes the predictions.
// Polite like the sync (SYNC-5): one request at a time, 2 s apart, a cap
// per run.

type EntryRow = typeof tennisEntries.$inferSelect;

// Tennis Canada's "Rookie" tournament category (U10 and younger), the
// site's "Online entry open" status, as the search form names them.
const ROOKIE_CATEGORY = "7207";
const ENTRY_OPEN = "2";
const MAX_SEARCH_PAGES = 5;
const ENTER_REQUESTS = 150;
const LIST_REQUESTS = 60;
const WATCH_REQUESTS = 40;
// How far ahead the draw watch looks.
const WATCH_DAYS = 7;

// Enters him in one event on the site. "unavailable": the app can't do it
// (not built yet, or no Tennis Canada login), so the owner uses the link.
export type Registrar = {
  enter(e: {
    tournamentId: string;
    eventNo: string;
    eventName: string;
  }): Promise<{ result: "entered" | "payment_needed" | "unavailable"; note?: string }>;
};

// Until the signed-in entry form is mapped (spikes.md SP-7, open), every
// entry is left to the owner.
export const manualRegistrar: Registrar = { enter: async () => ({ result: "unavailable" }) };

export type EntrySettings = { postalCode: string | null; prefs: EntryPrefs };

export function entrySettingsOf(config: unknown): EntrySettings {
  const entry = ((config ?? {}) as { entry?: Record<string, unknown> }).entry ?? {};
  const pc = typeof entry.homePostalCode === "string" ? entry.homePostalCode.trim().toUpperCase() : "";
  return { postalCode: pc || null, prefs: entryPrefsOf(entry) };
}

export type EntryContext = {
  db: Db;
  log: Logger;
  now: Date;
  timeZone: string;
  client?: (max: number) => TcClient;
};

const newClient = (ctx: EntryContext, max: number) => ctx.client?.(max) ?? new TcClient(tennisBaseUrl(), max);

type TcSource = { id: string; name: string; config: unknown };

export async function tennisSources(db: DbOrTx): Promise<TcSource[]> {
  return db
    .select({ id: sources.id, name: sources.name, config: sources.config })
    .from(sources)
    .where(and(eq(sources.kind, "tennis_tc"), eq(sources.enabled, true)));
}

async function selfName(db: DbOrTx, sourceId: string): Promise<string | null> {
  const [me] = await db
    .select({ name: tennisPlayers.name })
    .from(tennisPlayers)
    .where(and(eq(tennisPlayers.sourceId, sourceId), eq(tennisPlayers.isSelf, true)));
  return me?.name ?? null;
}

const eventPath = (tournamentId: string, eventNo: string) =>
  `/sport/event.aspx?id=${tournamentId}&event=${eventNo}`;

async function readEvent(client: TcClient, e: Pick<EntryRow, "tournamentExternalId" | "eventNo">) {
  const page = await client.get(eventPath(e.tournamentExternalId, e.eventNo));
  return page ? parseEventPage(page.html) : null;
}

function listUpdate(e: EntryRow, page: TcEventPage, name: string, now: Date) {
  const row = findSelfRow(page.entries, { name, tournamentPlayerId: e.tournamentPlayerId });
  const next = statusFromList(e.status as EntryStatus, row);
  return {
    status: next.status,
    reservePosition: next.reservePosition,
    tournamentPlayerId: row?.tournamentPlayerIds[0] ?? e.tournamentPlayerId,
    listCheckedAt: now,
    updatedAt: now,
    note:
      next.status === "withdrawn" ? "No longer on the entry list." : e.status === next.status ? e.note : null,
  };
}

export type EnterResult = { found: number; entered: number; left: number; skipped: number };

// Thursday: find and enter.
export async function runEnter(
  ctx: EntryContext,
  source: TcSource,
  deps: { drive: DriveTimer | null; registrar: Registrar },
): Promise<EnterResult | { skipped: string }> {
  const { db, log } = ctx;
  const settings = entrySettingsOf(source.config);
  if (!settings.postalCode) return { skipped: "no home postal code in the source's entry settings" };
  const name = await selfName(db, source.id);
  if (!name) return { skipped: "no tennis sync yet (his name isn't known)" };
  const today = localDate(ctx.now, ctx.timeZone);
  const client = newClient(ctx, ENTER_REQUESTS);
  const base = client.base;
  const known = await db.select().from(tennisEntries).where(eq(tennisEntries.sourceId, source.id));
  const knownTournaments = new Set(known.map((e) => e.tournamentExternalId));
  const radius = deps.drive
    ? searchRadiusKm(settings.prefs.maxDriveMinutes)
    : fallbackRadiusKm(settings.prefs.maxDriveMinutes);

  type Found = {
    tournamentId: string;
    name: string;
    startDate: string;
    endDate: string;
    venue: string | null;
    city: string | null;
    region: string | null;
    entryDeadline: string | null;
    eventNo: string;
    eventName: string;
    driveMinutes: number | null;
    page: TcEventPage | null;
  };
  const found: Found[] = [];
  try {
    for (let pageNo = 1; pageNo <= MAX_SEARCH_PAGES; pageNo++) {
      const res = await client.get("/find/tournament/DoSearch", {
        xhr: true,
        form: {
          Page: String(pageNo),
          "TournamentFilter.DateFilterType": "0",
          "TournamentFilter.PostalCode": settings.postalCode,
          "TournamentFilter.Distance": String(radius),
          "TournamentExtendedFilter.StatusFilterID": ENTRY_OPEN,
          "TournamentExtendedFilter.TournamentCategoryIDList[0]": ROOKIE_CATEGORY,
        },
      });
      const results = res ? parseSearchResults(res.html) : [];
      for (const t of results) {
        if (knownTournaments.has(t.id) || (t.startDate && t.startDate < today)) continue;
        knownTournaments.add(t.id);
        const list = await client.get(`/sport/events.aspx?id=${t.id}`);
        const event = list ? pickEvent(parseEventList(list.html), settings.prefs) : null;
        if (!event) continue;
        const overview = await client.get(`/tournament/${t.id}`);
        const d = overview ? parseTournament(overview.html, t.id) : null;
        const startDate = d?.startDate ?? t.startDate;
        if (!startDate || startDate < today) continue;
        const endDate = d?.endDate ?? t.endDate ?? startDate;
        const where = [d?.venue ?? t.venue, d?.city, d?.region].filter(Boolean).join(", ");
        let driveMinutes: number | null = null;
        if (deps.drive && where) {
          try {
            driveMinutes = await deps.drive(`${settings.postalCode}, Canada`, `${where}, Canada`);
          } catch (err) {
            log("drive time failed", { error: err }, "WARNING");
          }
          if (driveMinutes !== null && driveMinutes > settings.prefs.maxDriveMinutes) continue;
        }
        found.push({
          tournamentId: t.id,
          name: d?.name ?? t.name,
          startDate,
          endDate: endDate < startDate ? startDate : endDate,
          venue: d?.venue ?? t.venue,
          city: d?.city ?? null,
          region: d?.region ?? null,
          entryDeadline: d?.entryDeadline ?? null,
          eventNo: event.eventNo,
          eventName: event.name,
          driveMinutes,
          page: await readEvent(client, { tournamentExternalId: t.id, eventNo: event.eventNo }),
        });
      }
      if (results.length < 20) break;
    }
  } catch (err) {
    if (!(err instanceof Budget)) throw err;
    log(
      "tennis entries: reached the page limit; the rest are read next time",
      { source: source.name },
      "WARNING",
    );
  }

  // Already on a list (the owner entered him by hand): record that and
  // don't enter again.
  const listed = found.filter((f) => f.page && findSelfRow(f.page.entries, { name }));
  const open = found.filter((f) => !listed.includes(f));
  const committed = [...known.filter((e) => ACTIVE_ENTRY.includes(e.status as EntryStatus)), ...listed];
  const { enter, skip } = chooseEntries(open, committed);

  const now = ctx.now;
  const row = (f: Found, status: EntryStatus, extra: Partial<EntryRow> = {}) => ({
    sourceId: source.id,
    tournamentExternalId: f.tournamentId,
    tournamentName: f.name,
    startDate: f.startDate,
    endDate: f.endDate,
    venue: f.venue,
    city: f.city,
    region: f.region,
    entryDeadline: f.entryDeadline,
    eventNo: f.eventNo,
    eventName: f.eventName,
    driveMinutes: f.driveMinutes,
    driveEstimated: f.driveMinutes === null,
    status,
    tournamentUrl: `${base}/tournament/${f.tournamentId}`,
    entryUrl: `${base}/individual-entry/${f.tournamentId}`,
    ...extra,
  });
  const result: EnterResult = { found: found.length, entered: 0, left: 0, skipped: skip.length };
  const values = [];
  for (const f of listed) {
    const r = findSelfRow(f.page!.entries, { name })!;
    const s = statusFromList("entered", r);
    values.push(
      row(f, s.status, {
        reservePosition: s.reservePosition,
        tournamentPlayerId: r.tournamentPlayerIds[0] ?? null,
        listCheckedAt: now,
        note: "Already on the entry list.",
      }),
    );
  }
  for (const f of enter) {
    let outcome: Awaited<ReturnType<Registrar["enter"]>> = { result: "unavailable" };
    try {
      outcome = await deps.registrar.enter({
        tournamentId: f.tournamentId,
        eventNo: f.eventNo,
        eventName: f.eventName,
      });
    } catch (err) {
      log("tennis entry failed", { tournament: f.tournamentId, error: err }, "WARNING");
      outcome = { result: "unavailable", note: "Entering on the site failed; use the link." };
    }
    if (outcome.result === "unavailable") {
      result.left++;
      values.push(row(f, "found", { note: outcome.note ?? null }));
    } else {
      result.entered++;
      values.push(row(f, outcome.result, { enteredAt: now, note: outcome.note ?? null }));
    }
  }
  for (const { candidate: f, because } of skip)
    values.push(
      row(f, "skipped", {
        note: because
          ? `Same dates as ${because.name}, which is closer.`
          : "He's already entered for these dates.",
      }),
    );
  if (values.length)
    await db
      .insert(tennisEntries)
      .values(values)
      .onConflictDoNothing({
        target: [tennisEntries.sourceId, tennisEntries.tournamentExternalId, tennisEntries.eventNo],
      });
  log("tennis entries found", { source: source.name, ...result, requests: client.requests });
  return result;
}

// Friday: where does he stand on each entry list?
export async function runAcceptance(ctx: EntryContext, source: TcSource) {
  const { db, log } = ctx;
  const name = await selfName(db, source.id);
  if (!name) return { skipped: "no tennis sync yet (his name isn't known)" };
  const today = localDate(ctx.now, ctx.timeZone);
  const rows = await db
    .select()
    .from(tennisEntries)
    .where(
      and(
        eq(tennisEntries.sourceId, source.id),
        inArray(tennisEntries.status, ["found", ...ACTIVE_ENTRY]),
        gte(tennisEntries.endDate, today),
      ),
    );
  const client = newClient(ctx, LIST_REQUESTS);
  const counts: Record<string, number> = {};
  try {
    for (const e of rows) {
      const page = await readEvent(client, e);
      if (!page) continue;
      const update = listUpdate(e, page, name, ctx.now);
      await db.update(tennisEntries).set(update).where(eq(tennisEntries.id, e.id));
      counts[update.status] = (counts[update.status] ?? 0) + 1;
    }
  } catch (err) {
    if (!(err instanceof Budget)) throw err;
  }
  log("tennis acceptance lists read", { source: source.name, entries: rows.length, ...counts });
  return counts;
}

// Is he in one of these draws? Knockout draws come as a bracket, round
// robin and the like as a match list.
async function inDraw(client: TcClient, tournamentId: string, drawNos: string[], tp: string) {
  for (const drawNo of drawNos) {
    const bracket = await client.get(`/tournament/${tournamentId}/Draw/${drawNo}/GetDrawContent`, {
      xhr: true,
    });
    let matches = bracket ? parseBracket(bracket.html, tournamentId, drawNo).flatMap((r) => r.matches) : [];
    if (!matches.length) {
      const list = await client.get(`/tournament/${tournamentId}/Draw/${drawNo}/GetMatchesContent`, {
        xhr: true,
      });
      matches = list ? parseDrawMatches(list.html, tournamentId, drawNo) : [];
    }
    if (matches.some((m) => m.sides.some((s) => s.players.some((p) => p.tournamentPlayerId === tp))))
      return true;
  }
  return false;
}

export type WatchResult = {
  watching: number;
  seen: number;
  sync: "not needed" | "ran" | "skipped" | "failed";
};

// Monday, hourly: once his draw is out, run the full sync. Costs nothing
// when there's nothing to watch.
export async function runDrawWatch(
  ctx: EntryContext,
  source: TcSource,
  sync: (sourceId: string) => Promise<"succeeded" | "failed" | "skipped">,
): Promise<WatchResult | { skipped: string }> {
  const { db, log } = ctx;
  const today = localDate(ctx.now, ctx.timeZone);
  const rows = await db
    .select()
    .from(tennisEntries)
    .where(
      and(
        eq(tennisEntries.sourceId, source.id),
        inArray(tennisEntries.status, [...ACTIVE_ENTRY]),
        lte(tennisEntries.startDate, addDays(today, WATCH_DAYS)),
        gte(tennisEntries.endDate, today),
        isNull(tennisEntries.drawSyncedAt),
      ),
    );
  if (!rows.length) return { watching: 0, seen: 0, sync: "not needed" };
  const name = await selfName(db, source.id);
  if (!name) return { skipped: "no tennis sync yet (his name isn't known)" };
  const client = newClient(ctx, WATCH_REQUESTS);
  const pending: string[] = rows.filter((e) => e.drawSeenAt).map((e) => e.id);
  try {
    for (const e of rows) {
      if (e.drawSeenAt) continue;
      const page = await readEvent(client, e);
      if (!page) continue;
      const update = listUpdate(e, page, name, ctx.now);
      const tp = update.tournamentPlayerId;
      const set: Partial<EntryRow> = { ...update };
      if (page.draws.length && tp) {
        if (
          await inDraw(
            client,
            e.tournamentExternalId,
            page.draws.map((d) => d.drawNo),
            tp,
          )
        ) {
          set.drawSeenAt = ctx.now;
          pending.push(e.id);
        } else if (update.status !== "main_draw") {
          // The draw is out and he isn't in it (still a reserve): stop watching.
          set.drawSyncedAt = ctx.now;
          set.note = "The draw is out and he isn't in it.";
        }
      }
      await db.update(tennisEntries).set(set).where(eq(tennisEntries.id, e.id));
    }
  } catch (err) {
    if (!(err instanceof Budget)) throw err;
  }
  let status: WatchResult["sync"] = "not needed";
  if (pending.length) {
    const outcome = await sync(source.id);
    status = outcome === "succeeded" ? "ran" : outcome;
    if (outcome === "succeeded")
      await db
        .update(tennisEntries)
        .set({ drawSyncedAt: ctx.now, updatedAt: sql`now()` })
        .where(inArray(tennisEntries.id, pending));
  }
  const result = { watching: rows.length, seen: pending.length, sync: status };
  log("tennis draw watch", { source: source.name, ...result, requests: client.requests });
  return result;
}

// What the sync crawls on top of his profile: tournaments he's entered in
// that may not show there yet (before the draw, or before he's played).
export type SyncEntry = {
  tournamentId: string;
  name: string;
  startDate: string;
  endDate: string;
  eventNo: string;
  eventName: string;
  tournamentPlayerId: string | null;
};

export async function syncEntries(db: DbOrTx, sourceId: string, today: string): Promise<SyncEntry[]> {
  const rows = await db
    .select()
    .from(tennisEntries)
    .where(
      and(
        eq(tennisEntries.sourceId, sourceId),
        inArray(tennisEntries.status, [...ACTIVE_ENTRY]),
        gte(tennisEntries.endDate, addDays(today, -10)),
      ),
    );
  return rows.map((e) => ({
    tournamentId: e.tournamentExternalId,
    name: e.tournamentName,
    startDate: e.startDate,
    endDate: e.endDate,
    eventNo: e.eventNo,
    eventName: e.eventName,
    tournamentPlayerId: e.tournamentPlayerId,
  }));
}

// For the Tennis page: entries still to come, soonest first.
export async function listEntries(db: DbOrTx, today: string) {
  return db
    .select()
    .from(tennisEntries)
    .where(gte(tennisEntries.endDate, today))
    .orderBy(tennisEntries.startDate, tennisEntries.tournamentName);
}
export type EntryView = Awaited<ReturnType<typeof listEntries>>[number];
