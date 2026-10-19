import { and, eq, gte, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  settings,
  swimEntries,
  swimMeets,
  swimResults,
  tennisEntries,
  tennisMatches,
  tennisPlayers,
  tennisTournaments,
} from "@db/schema";
import { annotatePbs, eventKey, eventLabel, formatSwimTime } from "../../domain/swim";
import type { Course, Stroke } from "../../domain/swim-constants";
import { sportText, type SportSource, type VideoSport } from "../../domain/video-constants";
import { addDays, localDate } from "../../domain/time";
import type { DbOrTx } from "../db/client";
import { loadCalendar } from "../calendar/load";
import { getHomeTimeZone } from "../settings";
import { listTournaments } from "../tennis/load";
import { claim, claimed, notify, type NotifyDeps } from "./notify";

// What each kind of notification says, and when it fires (intent 0004,
// PUSH-1, PUSH-4, PUSH-5). The dedup keys carry the state that matters, so
// the same event never notifies twice, whichever job notices it.

const CLASH_DAYS = 14;
// Intent 0023, NTF-C3: a clash still open this close to its start pushes
// once more, unless the first push went out in the last day.
const CLASH_REMINDER_MS = 48 * 3_600_000;
// NTF-T5, NTF-S3: older results are history being read, not news.
const RESULT_DAYS = 7;

function dayLabel(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

function timeLabel(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// "New clash in the next 14 days": clashes the owner hasn't accepted. A
// clash that goes and comes back keeps its key, so it notifies once.
export async function notifyClashes(db: DbOrTx, deps: NotifyDeps = {}) {
  const now = deps.now ?? new Date();
  const cal = await loadCalendar(db, now, new Date(now.getTime() + CLASH_DAYS * 86_400_000));
  const byId = new Map(cal.events.map((e) => [e.id, e]));
  let sent = 0;
  for (const c of cal.clashes) {
    if (c.acceptedId) continue;
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    if (!a || !b) continue;
    const [first, second] = a.start <= b.start ? [a, b] : [b, a];
    if (new Date(second.end) <= now) continue;
    const day = dayLabel(first.start, cal.homeTimeZone);
    const body =
      first.allDay || second.allDay
        ? `${first.title} and ${second.title}`
        : `${first.title} (${timeLabel(first.start, cal.homeTimeZone)}) and ${second.title} (${timeLabel(second.start, cal.homeTimeZone)})`;
    // The app opens the clash screen for a clash push; builds before intent
    // 0023 open the first event, as before.
    const target = `events/${first.id}`;
    const key = `clash:${c.a}|${c.b}`;
    const id = await notify(
      db,
      { kind: "clash", dedupKey: key, title: `Clash on ${day}`, body, target },
      deps,
    );
    if (id) {
      sent++;
      continue;
    }
    const startsIn = new Date(first.start).getTime() - now.getTime();
    const firstSent = await claimed(db, key);
    if (startsIn > CLASH_REMINDER_MS || startsIn < 0) continue;
    if (firstSent && now.getTime() - firstSent.getTime() < 86_400_000) continue;
    const reminder = await notify(
      db,
      {
        kind: "clash",
        dedupKey: `clash_reminder:${c.a}|${c.b}`,
        title: `Still a clash on ${day}`,
        body,
        target,
      },
      deps,
    );
    if (reminder) sent++;
  }
  return sent;
}

// The first run after intent 0023 ships marks what's already known as
// noticed, so old entries and results don't push (spec N-3).
async function firstRun(db: DbOrTx, area: string): Promise<boolean> {
  const rows = await db
    .insert(settings)
    .values({ key: `notified_since:${area}`, value: new Date().toISOString() })
    .onConflictDoNothing({ target: settings.key })
    .returning({ key: settings.key });
  return rows.length > 0;
}

function sets(raw: unknown, flip: boolean): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .filter((s): s is [number, number] => Array.isArray(s) && s.length === 2)
    .map(([x, y]) => (flip ? `${y}-${x}` : `${x}-${y}`))
    .join(" ");
}

// NTF-T5 text: "Won 6-3 6-4 against <name> (<round>)", from his side.
export function tennisResultText(m: {
  won: boolean;
  outcome: string;
  sets: string;
  opponent: string;
  round: string | null;
}): string {
  const how =
    m.outcome === "walkover"
      ? `${m.won ? "Won" : "Lost"} by walkover`
      : `${m.won ? "Won" : "Lost"}${m.sets ? ` ${m.sets}` : ""}${m.outcome === "retired" ? " (retired)" : ""}`;
  return `${how} against ${m.opponent}${m.round ? ` (${m.round})` : ""}.`;
}

// NTF-T5: each of his matches, once, when it gets a winner.
export async function notifyTennisResults(db: DbOrTx, deps: NotifyDeps = {}) {
  const now = deps.now ?? new Date();
  const since = addDays(localDate(now, await getHomeTimeZone(db)), -RESULT_DAYS);
  const selfIds = (
    await db.select({ id: tennisPlayers.id }).from(tennisPlayers).where(eq(tennisPlayers.isSelf, true))
  ).map((p) => p.id);
  if (!selfIds.length) return 0;
  const rows = await db
    .select({ m: tennisMatches, tournament: tennisTournaments.name })
    .from(tennisMatches)
    .leftJoin(tennisTournaments, eq(tennisTournaments.id, tennisMatches.tournamentId))
    .where(
      and(
        isNotNull(tennisMatches.winner),
        eq(tennisMatches.status, "active"),
        isNull(tennisMatches.deletedAt),
        gte(tennisMatches.matchDate, since),
        or(
          inArray(tennisMatches.side1, selfIds),
          inArray(tennisMatches.side1Partner, selfIds),
          inArray(tennisMatches.side2, selfIds),
          inArray(tennisMatches.side2Partner, selfIds),
        ),
      ),
    );
  const silent = await firstRun(db, "tennis_result");
  const others = [
    ...new Set(rows.flatMap(({ m }) => [m.side1, m.side1Partner, m.side2, m.side2Partner])),
  ].filter((id): id is string => !!id && !selfIds.includes(id));
  const names = new Map(
    others.length
      ? (
          await db
            .select({ id: tennisPlayers.id, name: tennisPlayers.name })
            .from(tennisPlayers)
            .where(inArray(tennisPlayers.id, others))
        ).map((p) => [p.id, p.name])
      : [],
  );
  let sent = 0;
  for (const { m, tournament } of rows) {
    const key = `tennis_result:${m.id}`;
    if (silent) {
      await claim(db, "tennis_result", key);
      continue;
    }
    const mySide = selfIds.includes(m.side1) || (m.side1Partner && selfIds.includes(m.side1Partner)) ? 1 : 2;
    const opp = (mySide === 1 ? [m.side2, m.side2Partner] : [m.side1, m.side1Partner])
      .map((id) => (id ? names.get(id) : null))
      .filter(Boolean)
      .join(" / ");
    const id = await notify(
      db,
      {
        kind: "tennis_result",
        dedupKey: key,
        title: tournament ?? m.eventName ?? "Tennis result",
        body: tennisResultText({
          won: m.winner === mySide,
          outcome: m.outcome,
          sets: sets(m.sets, mySide === 2),
          opponent: opp || "his opponent",
          round: m.round,
        }),
        target: m.tournamentId ? `tennis/tournaments/${m.tournamentId}` : "tennis/results",
      },
      deps,
    );
    if (id) sent++;
  }
  return sent;
}

type SwimLine = { distance: number; stroke: Stroke; course: Course };

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// NTF-S1: "50 Free 34.12, 100 Back NT".
export function swimEntriesText(entries: (SwimLine & { seedTimeMs: number | null })[]): string {
  return entries
    .map((e) => `${eventLabel(e, false)} ${e.seedTimeMs == null ? "NT" : formatSwimTime(e.seedTimeMs)}`)
    .join(", ");
}

// NTF-S3: "50 Free 34.12 (2nd, best time), 100 Back DQ (false start)".
export function swimResultsText(
  results: (SwimLine & {
    timeMs: number | null;
    place: number | null;
    dqReason: string | null;
    isPb: boolean;
  })[],
): string {
  return results
    .map((r) => {
      if (r.timeMs == null) return `${eventLabel(r, false)} ${r.dqReason ? `DQ (${r.dqReason})` : "no time"}`;
      const notes = [r.place ? ordinal(r.place) : null, r.isPb ? "best time" : null].filter(Boolean);
      return `${eventLabel(r, false)} ${formatSwimTime(r.timeMs)}${notes.length ? ` (${notes.join(", ")})` : ""}`;
    })
    .join(", ");
}

// NTF-S1, NTF-S3: after a swim sync, his entries in upcoming meets and
// his results from the last week. One push per meet for entries (then one
// per batch of events added), one per meet day for each batch of results.
export async function notifySwim(db: DbOrTx, sourceId: string, deps: NotifyDeps = {}) {
  const now = deps.now ?? new Date();
  const today = localDate(now, await getHomeTimeZone(db));
  const silent = await firstRun(db, "swim");
  let sent = 0;

  const meets = await db
    .select()
    .from(swimMeets)
    .where(
      and(
        eq(swimMeets.sourceId, sourceId),
        eq(swimMeets.status, "active"),
        isNull(swimMeets.deletedAt),
        gte(swimMeets.endDate, today),
      ),
    );
  const entries = meets.length
    ? await db
        .select()
        .from(swimEntries)
        .where(
          and(
            inArray(
              swimEntries.meetId,
              meets.map((m) => m.id),
            ),
            eq(swimEntries.status, "active"),
          ),
        )
    : [];
  for (const meet of meets) {
    const mine = entries
      .filter((e) => e.meetId === meet.id)
      .sort((a, b) => (a.meetDay ?? 0) - (b.meetDay ?? 0) || a.distance - b.distance);
    if (!mine.length) continue;
    const lines = mine.map((e) => ({ ...e, stroke: e.stroke as Stroke, course: e.course as Course }));
    const isNew: typeof lines = [];
    for (const e of lines) if (await claim(db, "swim", `swim_entry:${meet.id}:${eventKey(e)}`)) isNew.push(e);
    const meetKey = `swim_entered:${meet.id}`;
    if (silent) {
      await claim(db, "swim", meetKey);
      continue;
    }
    const first = !(await claimed(db, meetKey));
    if (!first && !isNew.length) continue;
    const id = await notify(
      db,
      first
        ? {
            kind: "swim",
            dedupKey: meetKey,
            title: `Entered: ${meet.name}`,
            body: swimEntriesText(lines),
            target: `swimming/meets/${meet.id}`,
          }
        : {
            kind: "swim",
            dedupKey: `swim_added:${meet.id}:${isNew.map(eventKey).join(",")}`,
            title: `Added to ${meet.name}`,
            body: swimEntriesText(isNew),
            target: `swimming/meets/${meet.id}`,
          },
      deps,
    );
    if (id) sent++;
  }

  // Every swim he has, for best times; the recent ones from this source push.
  const all = await db
    .select({
      id: swimResults.id,
      sourceId: swimResults.sourceId,
      meetId: swimResults.meetId,
      swimDate: swimResults.swimDate,
      distance: swimResults.distance,
      stroke: swimResults.stroke,
      course: swimResults.course,
      timeMs: swimResults.timeMs,
      place: swimResults.place,
      stage: swimResults.stage,
      dqReason: swimResults.dqReason,
    })
    .from(swimResults)
    .where(and(eq(swimResults.status, "active"), isNull(swimResults.deletedAt)));
  const swims = all.map((r) => ({ ...r, stroke: r.stroke as Stroke, course: r.course as Course }));
  const pbs = annotatePbs(swims);
  const since = addDays(today, -RESULT_DAYS);
  const byMeetDay = new Map<string, typeof swims>();
  for (const r of swims) {
    if (r.sourceId !== sourceId || !r.meetId || r.swimDate < since) continue;
    const k = `${r.meetId}|${r.swimDate}`;
    byMeetDay.set(k, [...(byMeetDay.get(k) ?? []), r]);
  }
  for (const [k, list] of byMeetDay) {
    const [meetId, date] = k.split("|");
    const fresh: typeof list = [];
    for (const r of list) if (await claim(db, "swim", `swim_result:${r.id}`)) fresh.push(r);
    if (silent || !fresh.length) continue;
    const [meet] = await db.select({ name: swimMeets.name }).from(swimMeets).where(eq(swimMeets.id, meetId));
    fresh.sort((a, b) => a.distance - b.distance || a.stroke.localeCompare(b.stroke));
    const id = await notify(
      db,
      {
        kind: "swim",
        dedupKey: `swim_results:${meetId}:${date}:${fresh[0].id}`,
        title: `Results: ${meet?.name ?? "swim meet"}`,
        body: swimResultsText(fresh.map((r) => ({ ...r, isPb: pbs.get(r.id)?.isPb ?? false }))),
        target: `swimming/meets/${meetId}`,
      },
      deps,
    );
    if (id) sent++;
  }
  return sent;
}

// TEN-11: his next match in each draw, once the opponent is known. The
// first one is "the draw is out"; each later round is a new opponent.
export async function notifyNextMatches(db: DbOrTx, deps: NotifyDeps = {}) {
  const { nextMatches } = await listTournaments(db);
  let sent = 0;
  for (const m of nextMatches) {
    const next = m.draw.next;
    if (next?.status !== "next" || !next.opponent) continue;
    const when = [next.date, next.time].filter(Boolean).join(" ");
    const id = await notify(
      db,
      {
        kind: "draw",
        dedupKey: `draw:${m.draw.id}:${next.round}:${next.opponent.name}`,
        title: `${m.tournament.name}: next match`,
        body: `${next.round} against ${next.opponent.name}${when ? `, ${when}` : ""}.`,
        target: `tennis/tournaments/${m.tournament.id}`,
      },
      deps,
    );
    if (id) sent++;
  }
  return sent;
}

// TEN-9: tournaments found for him that the owner has to enter, and
// entries started that the owner has to pay for.
export async function notifyEntryActions(db: DbOrTx, sourceId: string, deps: NotifyDeps = {}) {
  const now = deps.now ?? new Date();
  const today = localDate(now, await getHomeTimeZone(db));
  const rows = await db
    .select()
    .from(tennisEntries)
    .where(
      and(
        eq(tennisEntries.sourceId, sourceId),
        inArray(tennisEntries.status, ["found", "payment_needed"]),
        gte(tennisEntries.startDate, today),
      ),
    );
  for (const e of rows) {
    const pay = e.status === "payment_needed";
    await notify(
      db,
      {
        kind: "entry_action",
        dedupKey: `entry:${e.id}:${e.status}`,
        title: pay ? "Tournament entry to pay" : "Tournament to enter",
        body: pay
          ? `${e.tournamentName} (${e.eventName}, from ${e.startDate}): the entry is started; pay on the Tennis Canada site.`
          : `${e.tournamentName} (${e.eventName}, from ${e.startDate})${e.entryDeadline ? `: enter by ${e.entryDeadline}` : ""}.`,
        target: "tennis",
      },
      deps,
    );
  }
}

type EntryBefore = Pick<typeof tennisEntries.$inferSelect, "id" | "status" | "tournamentName" | "eventName">;

// TEN-10, intent 0017 ACC-6: accepted into the main draw (from entered,
// payment needed or the reserve list), or off the entry list. Intent 0023,
// NTF-T2: registered (entered).
export async function notifyEntryChange(
  db: DbOrTx,
  before: EntryBefore,
  after: string,
  deps: NotifyDeps = {},
) {
  if (after === before.status) return;
  const registered =
    ["found", "not_open", "skipped", "payment_needed"].includes(before.status) && after === "entered";
  const accepted = ["entered", "payment_needed", "reserve"].includes(before.status) && after === "main_draw";
  const gone = after === "withdrawn";
  if (!registered && !accepted && !gone) return;
  const what = `${before.tournamentName} (${before.eventName})`;
  await notify(
    db,
    {
      kind: "entry_change",
      dedupKey: `entry:${before.id}:${after}`,
      title: registered ? `Registered: ${what}` : accepted ? `Accepted: ${what}` : "Off the entry list",
      body: registered
        ? "He's entered; the acceptance list usually comes out the Friday before."
        : accepted
          ? before.status === "reserve"
            ? "Moved from the reserve list into the main draw."
            : "He's in the main draw."
          : `${what}: he's no longer on the entry list.`,
      target: gone ? "tennis" : `tennis/entries/${before.id}`,
    },
    deps,
  );
}

// A video review finished or failed. Keyed by when it finished, so a review
// run again notifies again.
export async function notifyVideo(
  db: DbOrTx,
  r: {
    id: string;
    status: "done" | "failed";
    sport: VideoSport;
    sportSource: SportSource;
    filmedOn: string;
    finishedAt: Date;
    error: string | null;
  },
  deps: NotifyDeps = {},
) {
  const what = `${sportText(r.sport, r.sportSource)} video from ${r.filmedOn}`;
  await notify(
    db,
    {
      kind: "video",
      dedupKey: `video:${r.id}:${r.finishedAt.toISOString()}`,
      title: r.status === "done" ? "Video review ready" : "Video review failed",
      body: r.status === "done" ? `${what}.` : `${what}: ${r.error ?? "it failed"}`,
      target: `videos/${r.id}`,
    },
    deps,
  );
}

// SYNC-4: a source that failed 3 times in a row, at most once a day.
export async function notifySyncFailed(
  db: DbOrTx,
  source: { id: string; name: string },
  message: string,
  deps: NotifyDeps = {},
) {
  const now = deps.now ?? new Date();
  const day = localDate(now, await getHomeTimeZone(db));
  await notify(
    db,
    {
      kind: "sync_failed",
      dedupKey: `sync_failed:${source.id}:${day}`,
      title: `${source.name} keeps failing`,
      body: message,
      target: "sources",
    },
    deps,
  );
}

// EML-2: new suggestions from one read of the mailbox.
export async function notifySuggestions(
  db: DbOrTx,
  source: { id: string; name: string },
  runId: string,
  count: number,
  deps: NotifyDeps = {},
) {
  if (count <= 0) return;
  await notify(
    db,
    {
      kind: "suggestion",
      dedupKey: `suggestion:${runId}`,
      title: count === 1 ? "New suggestion" : `${count} new suggestions`,
      body: `From ${source.name}. Nothing reaches the calendar until you approve it.`,
      target: "suggestions",
    },
    deps,
  );
}
