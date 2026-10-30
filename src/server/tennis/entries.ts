import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { sources, tennisEntries, tennisEntryList, tennisPlayers } from "@db/schema";
import { Budget, TcClient, tennisBaseUrl } from "../../adapters/tennis-tc";
import {
  parseEventList,
  parseEventPage,
  parseSearchResults,
  type TcEntryRow,
  type TcEvent,
  type TcEventPage,
  type TcSearchResult,
} from "../../adapters/tennis-tc/entry-parse";
import { parseBracket, parseDrawMatches, parseTournament } from "../../adapters/tennis-tc/parse";
import type { AccountEntry, MyEntry } from "../../adapters/tennis-tc/registrar";
import type { EntryStatus } from "../../domain/tennis-constants";
import {
  ACTIVE_ENTRY,
  chooseEntries,
  entryPrefsOf,
  fallbackRadiusKm,
  findSelfRow,
  nameTokens,
  pickEvent,
  searchRadiusKm,
  statusFromAccount,
  statusFromList,
  type EntryPrefs,
} from "../../domain/tennis-entry";
import { addDays, localDate } from "../../domain/time";
import type { Db, DbOrTx } from "../db/client";
import type { Logger } from "../log";
import { notifyEntryActions, notifyEntryChange } from "../push/kinds";
import type { DriveTimer } from "./drive";

// The tournament-entry jobs (TEN-9..11, plan M3b):
// - Thursday noon (`tennis:enter`): find U10 tournaments open for entry
//   near home, pick his event (e.g. U9 orange, else green), keep those within the
//   drive limit, one per weekend, and enter him, or list them with the
//   site's entry link for the owner.
// - Friday 10:00 (`tennis:acceptance`): read each event's entry list and
//   record main draw or reserve list (and place).
// - Both also look for tournaments he's already on an entry list for that
//   the app didn't enter him in (entered by hand, or before these jobs
//   ran), open for entry or not: his profile doesn't show a tournament
//   until he's played there.
// - Monday, hourly (`tennis:draw-watch`): for tournaments in the coming
//   week, look for his draw; once it's out, run the full tennis sync, which
//   reads the draw, his opponents (one hop) and writes the predictions.
// Polite like the sync (SYNC-5): one request at a time, 2 s apart, a cap
// per run.

type EntryRow = typeof tennisEntries.$inferSelect;

// The site's "U10" age group and "Online entry open" status, as the search
// form names them. The age group, not a tournament category: his events sit
// in Rookie tournaments and in Provincial ones ("Rising Stars") alike.
const U10_AGE_GROUP = "10";
const ENTRY_OPEN = "2";
const MAX_SEARCH_PAGES = 5;
const ENTER_REQUESTS = 150;
const LIST_REQUESTS = 100;
const WATCH_REQUESTS = 40;
// How far ahead the draw watch looks.
const WATCH_DAYS = 7;
// How far ahead the search for entries he already has looks.
const LISTED_DAYS = 28;
// Every refresh: how far ahead to look for matching tournaments, and the
// request cap for the whole refresh.
const DISCOVER_DAYS = 120;
const REFRESH_REQUESTS = 150;
// The quick check (intent 0012): his entries' lists and "My entries".
const CHECK_REQUESTS = 40;

// Enters him in one event on the site. "unavailable": the app can't do it
// (not built yet, or no Tennis Canada login), so the owner uses the link.
// myEntries, with a login: his account's "My entries" list (null when it
// can't be read), the site's own record of what he's entered.
export type Registrar = {
  enter(e: {
    tournamentId: string;
    eventNo: string;
    eventName: string;
  }): Promise<{ result: "entered" | "payment_needed" | "unavailable"; note?: string }>;
  myEntries?(): Promise<MyEntry[] | null>;
  // Why the login couldn't be used this run, if it couldn't.
  problem?(): string | null;
};

const accountNote = (status: EntryStatus) =>
  status === "payment_needed"
    ? "Entry started on the site; payment still needed (from his account's entries)."
    : "Entered on the site (from his account's entries).";

// His account's entries, read at most once a run. on(): what it says about
// one tournament (and event, when it names his events); null when there's
// no list to go on.
function accountChecker(registrar: Registrar | undefined, log: Logger) {
  let read: Promise<MyEntry[] | null> | null = null;
  const list = () =>
    (read ??= (async () => {
      if (!registrar?.myEntries) return null;
      try {
        return await registrar.myEntries();
      } catch (err) {
        log("tennis account entries failed", { error: err }, "WARNING");
        return null;
      }
    })());
  return {
    list,
    async on(tournamentId: string, eventNo?: string): Promise<AccountEntry | null> {
      const mine = await list();
      if (!mine) return null;
      const m = mine.find((m) => m.tournamentId === tournamentId.toLowerCase());
      if (!m) return "not_entered";
      if (eventNo && m.events.length && !m.events.some((e) => e.eventNo === eventNo)) return "not_entered";
      return m.status;
    },
  };
}
type AccountCheck = ReturnType<typeof accountChecker>;

// Leaves every entry to the owner (automatic entry switched off). The
// worker's registrar uses the site's entry form (src/worker/tennis-registrar.ts).
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

// ACC-4 (intent 0017): keep the list as read, replacing the last one. A
// hidden list (no rows) leaves the stored one.
async function saveList(db: DbOrTx, entryId: string, page: TcEventPage | null) {
  if (!page?.entriesShown || !page.entries.length) return;
  const rows = page.entries.map((r: TcEntryRow, position) => ({
    entryId,
    position,
    names: r.names,
    tournamentPlayerIds: r.tournamentPlayerIds,
    status: r.status?.kind ?? null,
    reservePosition: r.status?.kind === "reserve" ? r.status.position : null,
  }));
  await db.delete(tennisEntryList).where(eq(tennisEntryList.entryId, entryId));
  await db.insert(tennisEntryList).values(rows);
}

function listUpdate(
  e: EntryRow,
  page: TcEventPage,
  name: string,
  now: Date,
  account: AccountEntry | null = null,
) {
  if (!page.entriesShown) {
    // No list to read (once the draws are made): he stays as he was,
    // unless his account says more.
    const status = statusFromAccount(e.status as EntryStatus, account);
    return {
      status,
      reservePosition: e.reservePosition,
      tournamentPlayerId: e.tournamentPlayerId,
      listCheckedAt: now,
      updatedAt: now,
      note: status === e.status ? e.note : accountNote(status),
    };
  }
  const row = findSelfRow(page.entries, { name, tournamentPlayerId: e.tournamentPlayerId });
  const listed = statusFromList(e.status as EntryStatus, row);
  // Not on the list yet (or not found on it), but his account has him.
  const next = { ...listed, status: statusFromAccount(listed.status, account) };
  return {
    status: next.status,
    reservePosition: next.reservePosition,
    tournamentPlayerId: row?.tournamentPlayerIds[0] ?? e.tournamentPlayerId,
    listCheckedAt: now,
    updatedAt: now,
    note:
      next.status === "withdrawn"
        ? row?.status?.kind === "excluded"
          ? "On the exclude list."
          : "No longer on the entry list."
        : e.status === next.status
          ? e.note
          : next.status !== listed.status
            ? accountNote(next.status)
            : null,
  };
}

type ListedValues = {
  status: EntryStatus;
  reservePosition: number | null;
  tournamentPlayerId: string | null;
  listCheckedAt: Date;
  note: string;
  updatedAt: Date;
};

// One search of the site, page by page (20 results a page).
async function search(client: TcClient, form: Record<string, string>): Promise<TcSearchResult[]> {
  const out: TcSearchResult[] = [];
  for (let pageNo = 1; pageNo <= MAX_SEARCH_PAGES; pageNo++) {
    const res = await client.get("/find/tournament/DoSearch", {
      xhr: true,
      form: { ...form, Page: String(pageNo) },
    });
    const results = res ? parseSearchResults(res.html) : [];
    out.push(...results);
    if (results.length < 20) break;
  }
  return out;
}

const searchForm = (settings: EntrySettings, radiusKm: number) => ({
  "TournamentFilter.DateFilterType": "0",
  "TournamentFilter.PostalCode": settings.postalCode!,
  "TournamentFilter.Distance": String(radiusKm),
  "TournamentExtendedFilter.AgeGroupID": U10_AGE_GROUP,
});

// His account's "My entries" list, for tournaments still to come: each
// event he's entered gets a row (a new one, or one found, skipped or not
// open yet moves on), and the tournament's other not-entered rows are
// marked skipped. Rows already entered, or on a list, are left to the list
// checks. Returns how many rows it wrote.
async function fromAccount(
  ctx: EntryContext,
  source: TcSource,
  client: TcClient,
  account: AccountCheck,
  today: string,
): Promise<number> {
  const mine = (await account.list()) ?? [];
  const live = mine.filter(
    (m) =>
      (m.status === "entered" || m.status === "payment_needed") &&
      m.events.length &&
      m.date &&
      m.date >= today,
  );
  if (!live.length) return 0;
  const rows = await ctx.db.select().from(tennisEntries).where(eq(tennisEntries.sourceId, source.id));
  let written = 0;
  for (const m of live) {
    const status: EntryStatus = m.status === "entered" ? "entered" : "payment_needed";
    const here = rows.filter((r) => r.tournamentExternalId === m.tournamentId);
    const entered = new Set(m.events.map((e) => e.eventNo));
    for (const event of m.events) {
      const row = here.find((r) => r.eventNo === event.eventNo);
      if (row) {
        const next = statusFromAccount(row.status as EntryStatus, status);
        if (next === row.status) continue;
        await ctx.db
          .update(tennisEntries)
          .set({ status: next, note: accountNote(next), listCheckedAt: ctx.now, updatedAt: ctx.now })
          .where(eq(tennisEntries.id, row.id));
        await notifyEntryChange(ctx.db, row, next, { log: ctx.log, now: ctx.now });
        written++;
        continue;
      }
      const overview = await client.get(`/tournament/${m.tournamentId}`);
      const d = overview ? parseTournament(overview.html, m.tournamentId) : null;
      const startDate = d?.startDate ?? m.date!;
      const endDate = d?.endDate ?? startDate;
      await ctx.db
        .insert(tennisEntries)
        .values({
          sourceId: source.id,
          tournamentExternalId: m.tournamentId,
          tournamentName: d?.name ?? m.name,
          startDate,
          endDate: endDate < startDate ? startDate : endDate,
          venue: d?.venue ?? m.venue,
          city: d?.city ?? m.city,
          region: d?.region ?? null,
          entryDeadline: d?.entryDeadline ?? null,
          eventNo: event.eventNo,
          eventName: event.name,
          driveMinutes: null,
          driveEstimated: true,
          status,
          listCheckedAt: ctx.now,
          note: accountNote(status),
          tournamentUrl: `${client.base}/tournament/${m.tournamentId}`,
          entryUrl: `${client.base}/individual-entry/${m.tournamentId}`,
        })
        .onConflictDoNothing();
      written++;
    }
    // The event the app picked isn't the one he was entered in.
    for (const r of here)
      if (!entered.has(r.eventNo) && ["found", "not_open"].includes(r.status)) {
        await ctx.db
          .update(tennisEntries)
          .set({
            status: "skipped",
            note: `He's entered in ${m.events.map((e) => e.name).join(", ")} instead.`,
            updatedAt: ctx.now,
          })
          .where(eq(tennisEntries.id, r.id));
        written++;
      }
  }
  return written;
}

// Tournaments he's entered (by hand, or before these jobs ran) that the app
// doesn't have as entered yet. First his account's "My entries" list, when
// the login is stored: every tournament, wherever it is. Then every U10
// tournament near home in the coming weeks, entry open or closed, and
// every event's list. Records each with where he stands. Tournaments
// already being followed (found or entered) are left to the list checks.
async function findListed(
  ctx: EntryContext,
  source: TcSource,
  client: TcClient,
  name: string,
  settings: EntrySettings,
  account: AccountCheck,
): Promise<number> {
  const today = localDate(ctx.now, ctx.timeZone);
  let recorded = 0;
  try {
    recorded += await fromAccount(ctx, source, client, account, today);
  } catch (err) {
    if (!(err instanceof Budget)) throw err;
    ctx.log(
      "tennis entries: reached the page limit reading his account's entries",
      { source: source.name },
      "WARNING",
    );
    return recorded;
  }
  if (!settings.postalCode) return recorded;
  const followed = new Set(
    (
      await ctx.db
        .select({ id: tennisEntries.tournamentExternalId })
        .from(tennisEntries)
        .where(
          and(
            eq(tennisEntries.sourceId, source.id),
            inArray(tennisEntries.status, ["found", ...ACTIVE_ENTRY]),
          ),
        )
    ).map((r) => r.id),
  );
  // The event already picked for a tournament (not open yet, or skipped),
  // so an entry seen only through his account lands on the same row.
  const picked = new Map(
    (
      await ctx.db
        .select({ id: tennisEntries.tournamentExternalId, eventNo: tennisEntries.eventNo })
        .from(tennisEntries)
        .where(eq(tennisEntries.sourceId, source.id))
    )
      .filter((r) => r.eventNo)
      .map((r) => [r.id, r.eventNo]),
  );
  try {
    const results = await search(client, {
      ...searchForm(settings, searchRadiusKm(settings.prefs.maxDriveMinutes)),
      "TournamentFilter.StartDate": `${today}T00:00`,
      "TournamentFilter.EndDate": `${addDays(today, LISTED_DAYS)}T00:00`,
    });
    for (const t of results) {
      if (followed.has(t.id) || (t.endDate ?? t.startDate ?? today) < today) continue;
      const list = await client.get(`/sport/events.aspx?id=${t.id}`);
      const events = list ? parseEventList(list.html) : [];
      const found: { event: TcEvent; values: ListedValues; page?: TcEventPage | null }[] = [];
      const hidden: TcEvent[] = [];
      for (const event of events) {
        const page = await readEvent(client, { tournamentExternalId: t.id, eventNo: event.eventNo });
        if (page && !page.entriesShown) hidden.push(event);
        const self = page && findSelfRow(page.entries, { name });
        if (!self) continue;
        const s = statusFromList("entered", self);
        found.push({
          event,
          page,
          values: {
            status: s.status,
            reservePosition: s.reservePosition,
            tournamentPlayerId: self.tournamentPlayerIds[0] ?? null,
            listCheckedAt: ctx.now,
            note: "Already on the entry list.",
            updatedAt: ctx.now,
          },
        });
      }
      // The site hides the list once the draws are made: ask his account.
      if (!found.length && hidden.length) {
        const answer = await account.on(t.id);
        const status = statusFromAccount("found", answer);
        const event =
          hidden.find((e) => e.eventNo === picked.get(t.id)) ??
          pickEvent(hidden, settings.prefs) ??
          hidden[0];
        if (status !== "found")
          found.push({
            event,
            values: {
              status,
              reservePosition: null,
              tournamentPlayerId: null,
              listCheckedAt: ctx.now,
              note: accountNote(status),
              updatedAt: ctx.now,
            },
          });
      }
      for (const { event, values, page } of found) {
        const overview = await client.get(`/tournament/${t.id}`);
        const d = overview ? parseTournament(overview.html, t.id) : null;
        const startDate = d?.startDate ?? t.startDate ?? today;
        const endDate = d?.endDate ?? t.endDate ?? startDate;
        await ctx.db
          .insert(tennisEntries)
          .values({
            sourceId: source.id,
            tournamentExternalId: t.id,
            tournamentName: d?.name ?? t.name,
            startDate,
            endDate: endDate < startDate ? startDate : endDate,
            venue: d?.venue ?? t.venue,
            city: d?.city ?? null,
            region: d?.region ?? null,
            entryDeadline: d?.entryDeadline ?? null,
            eventNo: event.eventNo,
            eventName: event.name,
            driveMinutes: null,
            driveEstimated: true,
            tournamentUrl: `${client.base}/tournament/${t.id}`,
            entryUrl: `${client.base}/individual-entry/${t.id}`,
            ...values,
          })
          .onConflictDoUpdate({
            target: [tennisEntries.sourceId, tennisEntries.tournamentExternalId, tennisEntries.eventNo],
            set: values,
          })
          .returning({ id: tennisEntries.id })
          .then(async ([saved]) => saved && (await saveList(ctx.db, saved.id, page ?? null)));
        recorded++;
      }
    }
  } catch (err) {
    if (!(err instanceof Budget)) throw err;
    ctx.log(
      "tennis entries: reached the page limit looking for his entries",
      { source: source.name },
      "WARNING",
    );
  }
  return recorded;
}

export type EnterResult = { listed: number; found: number; entered: number; left: number; skipped: number };

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
  const alreadyListed = await findListed(
    ctx,
    source,
    client,
    name,
    settings,
    accountChecker(deps.registrar, log),
  );
  const known = await db.select().from(tennisEntries).where(eq(tennisEntries.sourceId, source.id));
  // Ones found before entry opened are looked at again now.
  const knownTournaments = new Set(
    known.filter((e) => e.status !== "not_open").map((e) => e.tournamentExternalId),
  );
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
    entryOpens: string | null;
    eventNo: string;
    eventName: string;
    driveMinutes: number | null;
    page: TcEventPage | null;
  };
  const found: Found[] = [];
  try {
    const results = await search(client, {
      ...searchForm(settings, radius),
      "TournamentExtendedFilter.StatusFilterID": ENTRY_OPEN,
    });
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
        entryOpens: d?.entryOpens ?? null,
        eventNo: event.eventNo,
        eventName: event.name,
        driveMinutes,
        page: await readEvent(client, { tournamentExternalId: t.id, eventNo: event.eventNo }),
      });
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
    entryOpens: f.entryOpens,
    eventNo: f.eventNo,
    eventName: f.eventName,
    driveMinutes: f.driveMinutes,
    driveEstimated: f.driveMinutes === null,
    status,
    tournamentUrl: `${base}/tournament/${f.tournamentId}`,
    entryUrl: `${base}/individual-entry/${f.tournamentId}`,
    ...extra,
  });
  const result: EnterResult = {
    listed: alreadyListed,
    found: found.length,
    entered: 0,
    left: 0,
    skipped: skip.length,
  };
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
      .onConflictDoUpdate({
        target: [tennisEntries.sourceId, tennisEntries.tournamentExternalId, tennisEntries.eventNo],
        // Only a "not open yet" row gives way to what the job decided now.
        set: {
          status: sql`excluded.status`,
          note: sql`excluded.note`,
          reservePosition: sql`excluded.reserve_position`,
          tournamentPlayerId: sql`excluded.tournament_player_id`,
          listCheckedAt: sql`excluded.list_checked_at`,
          enteredAt: sql`excluded.entered_at`,
          entryDeadline: sql`excluded.entry_deadline`,
          entryOpens: sql`excluded.entry_opens`,
          driveMinutes: sql`excluded.drive_minutes`,
          driveEstimated: sql`excluded.drive_estimated`,
          updatedAt: now,
        },
        setWhere: eq(tennisEntries.status, "not_open"),
      });
  // TEN-9: the ones the owner has to enter or pay for (once each).
  await notifyEntryActions(db, source.id, { log, now });
  log("tennis entries found", { source: source.name, ...result, requests: client.requests });
  return result;
}

// Not settled yet (intent 0017, ACC-2): the later Friday runs read only
// these. Reserve places can still move into the main draw.
const UNSETTLED: readonly EntryStatus[] = ["found", "entered", "payment_needed", "reserve"];
// Unsettled, or accepted with no list kept yet (accepted before the lists
// were kept, or the list was already hidden) and not read in the last 12
// hours: at most one read a run day keeps it, or settles that it's gone.
const unsettled = (now: Date) =>
  or(
    inArray(tennisEntries.status, [...UNSETTLED]),
    and(
      eq(tennisEntries.status, "main_draw"),
      sql`not exists (select 1 from ${tennisEntryList} where ${tennisEntryList.entryId} = ${tennisEntries.id})`,
      or(
        isNull(tennisEntries.listCheckedAt),
        lt(tennisEntries.listCheckedAt, new Date(now.getTime() - 12 * 3600_000)),
      ),
    ),
  );

// Where does he stand on each entry list still to come? `unsettled`: only
// the entries not in the main draw yet.
async function checkLists(
  ctx: EntryContext,
  source: TcSource,
  client: TcClient,
  name: string,
  account: AccountCheck,
  opts: { unsettled?: boolean } = {},
) {
  const { db, log } = ctx;
  const today = localDate(ctx.now, ctx.timeZone);
  const rows = await db
    .select()
    .from(tennisEntries)
    .where(
      and(
        eq(tennisEntries.sourceId, source.id),
        opts.unsettled ? unsettled(ctx.now) : inArray(tennisEntries.status, ["found", ...ACTIVE_ENTRY]),
        gte(tennisEntries.endDate, today),
      ),
    );
  const counts: Record<string, number> = {};
  try {
    for (const e of rows) {
      const page = await readEvent(client, e);
      if (!page) continue;
      const update = listUpdate(e, page, name, ctx.now, await account.on(e.tournamentExternalId, e.eventNo));
      // ACC-3: the list is gone behind the draws; his name in one of them
      // means he got in.
      if (!page.entriesShown && page.draws.length && ACTIVE_ENTRY.includes(update.status)) {
        if (update.status !== "main_draw") {
          const tp = await inDraw(
            client,
            e.tournamentExternalId,
            page.draws.map((d) => d.drawNo),
            { tp: e.tournamentPlayerId, name },
          );
          if (tp)
            Object.assign(update, {
              status: "main_draw",
              reservePosition: null,
              tournamentPlayerId: tp,
              note: null,
            });
        }
      }
      await db.update(tennisEntries).set(update).where(eq(tennisEntries.id, e.id));
      await saveList(db, e.id, page);
      await notifyEntryChange(db, e, update.status, { log, now: ctx.now });
      counts[update.status] = (counts[update.status] ?? 0) + 1;
    }
  } catch (err) {
    if (!(err instanceof Budget)) throw err;
  }
  return { entries: rows.length, ...counts };
}

// Friday: where does he stand on each entry list? With a registrar, his
// account answers where the list is hidden.
// Runs every 2 hours on Fridays (intent 0017, ACC-2): the first run reads
// every list and searches for entries made by hand; later ones (`later`)
// read only the entries not in the main draw yet, and make no requests
// when there are none.
export async function runAcceptance(
  ctx: EntryContext,
  source: TcSource,
  deps: { registrar?: Registrar; later?: boolean } = {},
) {
  const name = await selfName(ctx.db, source.id);
  if (!name) return { skipped: "no tennis sync yet (his name isn't known)" };
  if (deps.later) {
    const [open] = await ctx.db
      .select({ id: tennisEntries.id })
      .from(tennisEntries)
      .where(
        and(
          eq(tennisEntries.sourceId, source.id),
          unsettled(ctx.now),
          gte(tennisEntries.endDate, localDate(ctx.now, ctx.timeZone)),
        ),
      )
      .limit(1);
    if (!open) return { entries: 0, listed: 0 };
  }
  const client = newClient(ctx, LIST_REQUESTS);
  const account = accountChecker(deps.registrar, ctx.log);
  const counts = await checkLists(ctx, source, client, name, account, { unsettled: deps.later });
  const listed = deps.later
    ? 0
    : await findListed(ctx, source, client, name, entrySettingsOf(source.config), account);
  ctx.log("tennis acceptance lists read", { source: source.name, listed, ...counts });
  return { ...counts, listed };
}

// U10 tournaments near home in the coming months that the app hasn't
// seen. One that fits him and opens for entry later is kept as "not open
// yet" (the Thursday job enters him once it opens); one that doesn't fit is
// kept as skipped, with why. One open now is left to the Thursday job, and
// one with no events yet is read again next time.
async function discover(
  ctx: EntryContext,
  source: TcSource,
  client: TcClient,
  settings: EntrySettings,
  drive: DriveTimer | null,
): Promise<{ notOpen: number; skipped: number }> {
  const out = { notOpen: 0, skipped: 0 };
  if (!settings.postalCode) return out;
  const { db, log } = ctx;
  const today = localDate(ctx.now, ctx.timeZone);
  const known = new Set(
    (
      await db
        .select({ id: tennisEntries.tournamentExternalId })
        .from(tennisEntries)
        .where(eq(tennisEntries.sourceId, source.id))
    ).map((r) => r.id),
  );
  const radius = drive
    ? searchRadiusKm(settings.prefs.maxDriveMinutes)
    : fallbackRadiusKm(settings.prefs.maxDriveMinutes);
  try {
    const results = await search(client, {
      ...searchForm(settings, radius),
      "TournamentFilter.StartDate": `${today}T00:00`,
      "TournamentFilter.EndDate": `${addDays(today, DISCOVER_DAYS)}T00:00`,
    });
    for (const t of results) {
      if (known.has(t.id) || (t.startDate && t.startDate < today)) continue;
      known.add(t.id);
      const list = await client.get(`/sport/events.aspx?id=${t.id}`);
      const events = list ? parseEventList(list.html) : [];
      if (!events.length) continue;
      const event = pickEvent(events, settings.prefs);
      const overview = await client.get(`/tournament/${t.id}`);
      const d = overview ? parseTournament(overview.html, t.id) : null;
      const startDate = d?.startDate ?? t.startDate;
      if (!startDate || startDate < today) continue;
      const endDate = d?.endDate ?? t.endDate ?? startDate;
      let status: EntryStatus | null = null;
      let note: string | null = null;
      let driveMinutes: number | null = null;
      if (!event) {
        status = "skipped";
        note = `No event for him: ${events.map((e) => e.name).join(", ")}.`;
      } else {
        const where = [d?.venue ?? t.venue, d?.city, d?.region].filter(Boolean).join(", ");
        if (drive && where) {
          try {
            driveMinutes = await drive(`${settings.postalCode}, Canada`, `${where}, Canada`);
          } catch (err) {
            log("drive time failed", { error: err }, "WARNING");
          }
        }
        if (driveMinutes !== null && driveMinutes > settings.prefs.maxDriveMinutes) {
          status = "skipped";
          note = `About ${driveMinutes} min away, over the ${settings.prefs.maxDriveMinutes} min limit.`;
        } else if (d?.entryOpens && (d.entryOpens > today || (d.entryOpens === today && !t.entryOpen))) {
          // Entry opens at a time of day: on the day itself the search says
          // whether it has.
          status = "not_open";
        }
      }
      if (!status) continue;
      out[status === "skipped" ? "skipped" : "notOpen"]++;
      await db
        .insert(tennisEntries)
        .values({
          sourceId: source.id,
          tournamentExternalId: t.id,
          tournamentName: d?.name ?? t.name,
          startDate,
          endDate: endDate < startDate ? startDate : endDate,
          venue: d?.venue ?? t.venue,
          city: d?.city ?? null,
          region: d?.region ?? null,
          entryDeadline: d?.entryDeadline ?? null,
          entryOpens: d?.entryOpens ?? null,
          eventNo: event?.eventNo ?? "",
          eventName: event?.name ?? "",
          driveMinutes,
          driveEstimated: driveMinutes === null,
          status,
          note,
          tournamentUrl: `${client.base}/tournament/${t.id}`,
          entryUrl: `${client.base}/individual-entry/${t.id}`,
        })
        .onConflictDoNothing({
          target: [tennisEntries.sourceId, tennisEntries.tournamentExternalId, tennisEntries.eventNo],
        });
    }
  } catch (err) {
    if (!(err instanceof Budget)) throw err;
    log(
      "tennis entries: reached the page limit; the rest are read next time",
      { source: source.name },
      "WARNING",
    );
  }
  return out;
}

export type RefreshResult = Record<string, number>;

// After every Tennis sync (owner, 2026-09-30): where he stands on each
// entry list, entries he has that the app didn't make, and matching
// tournaments still to open (or skipped, with why). Never enters him:
// that stays with the Thursday job.
export async function runRefresh(
  ctx: EntryContext,
  source: TcSource,
  deps: { drive: DriveTimer | null; registrar?: Registrar },
): Promise<RefreshResult | { skipped: string }> {
  const name = await selfName(ctx.db, source.id);
  if (!name) return { skipped: "no tennis sync yet (his name isn't known)" };
  const settings = entrySettingsOf(source.config);
  const client = newClient(ctx, REFRESH_REQUESTS);
  const account = accountChecker(deps.registrar, ctx.log);
  const lists = await checkLists(ctx, source, client, name, account);
  const listed = await findListed(ctx, source, client, name, settings, account);
  const found = await discover(ctx, source, client, settings, deps.drive);
  const result = { ...lists, listed, ...found };
  ctx.log("tennis entries refreshed", { source: source.name, ...result, requests: client.requests });
  return result;
}

// His tournament player number in one of these draws, or null when he
// isn't in them: by number when known, else by name (no entry list to
// learn the number from). Knockout draws come as a bracket, round robin
// and the like as a match list.
async function inDraw(
  client: TcClient,
  tournamentId: string,
  drawNos: string[],
  self: { tp: string | null; name: string },
): Promise<string | null> {
  const key = nameTokens(self.name);
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
    for (const side of matches.flatMap((m) => m.sides)) {
      if (self.tp && side.players.some((p) => p.tournamentPlayerId === self.tp)) return self.tp;
      const [p] = side.players;
      if (!self.tp && side.players.length === 1 && p.tournamentPlayerId && nameTokens(p.name) === key)
        return p.tournamentPlayerId;
    }
  }
  return null;
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
      // Without an entry list, an empty draw (made, not filled) says nothing.
      if (page.draws.length && (tp || !page.entriesShown)) {
        const found = await inDraw(
          client,
          e.tournamentExternalId,
          page.draws.map((d) => d.drawNo),
          { tp, name },
        );
        if (found) {
          set.drawSeenAt = ctx.now;
          set.tournamentPlayerId = found;
          // ACC-3: in the draw means accepted, list or not.
          if (set.status !== "main_draw")
            Object.assign(set, { status: "main_draw", reservePosition: null, note: null });
          pending.push(e.id);
        } else if (tp && page.entriesShown && update.status !== "main_draw") {
          // The draw is out and he isn't in it (still a reserve): stop watching.
          set.drawSyncedAt = ctx.now;
          set.note = "The draw is out and he isn't in it.";
        }
      }
      await db.update(tennisEntries).set(set).where(eq(tennisEntries.id, e.id));
      await saveList(db, e.id, page);
      await notifyEntryChange(db, e, set.status ?? update.status, { log, now: ctx.now });
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

// The quick check (intent 0012, TPR-2, TPR-3), for pull to refresh: his
// account's entries and each entry list, then his draws: one seen for the
// first time runs the full sync (as the draw watch), one already in has
// only its tournament re-read (`syncDraws`). No tournament search.
export async function runCheck(
  ctx: EntryContext,
  source: TcSource,
  deps: {
    registrar?: Registrar;
    sync: (sourceId: string) => Promise<"succeeded" | "failed" | "skipped">;
    syncDraws: (sourceId: string, tournamentIds: string[]) => Promise<void>;
  },
): Promise<{ counts: Record<string, number>; problem: string | null } | { skipped: string }> {
  const name = await selfName(ctx.db, source.id);
  if (!name) return { skipped: "no tennis sync yet (his name isn't known)" };
  const today = localDate(ctx.now, ctx.timeZone);
  const client = newClient(ctx, CHECK_REQUESTS);
  const account = accountChecker(deps.registrar, ctx.log);
  let listed = 0;
  try {
    listed = await fromAccount(ctx, source, client, account, today);
  } catch (err) {
    if (!(err instanceof Budget)) throw err;
  }
  const lists = await checkLists(ctx, source, client, name, account);
  const watch = await runDrawWatch(ctx, source, deps.sync);
  // Tournaments under way (or about to be) whose draw is already in.
  const synced = await ctx.db
    .selectDistinct({ id: tennisEntries.tournamentExternalId })
    .from(tennisEntries)
    .where(
      and(
        eq(tennisEntries.sourceId, source.id),
        inArray(tennisEntries.status, [...ACTIVE_ENTRY]),
        lte(tennisEntries.startDate, addDays(today, WATCH_DAYS)),
        gte(tennisEntries.endDate, today),
        isNotNull(tennisEntries.drawSyncedAt),
      ),
    );
  if (synced.length)
    await deps.syncDraws(
      source.id,
      synced.map((r) => r.id),
    );
  const counts = {
    ...lists,
    listed,
    drawsSeen: "seen" in watch ? watch.seen : 0,
    drawsRead: synced.length,
    requests: client.requests,
  };
  ctx.log("tennis check done", { source: source.name, ...counts });
  return { counts, problem: deps.registrar?.problem?.() ?? null };
}
