import { and, eq, gte, inArray } from "drizzle-orm";
import { tennisEntries } from "@db/schema";
import {
  MODEL_LABEL,
  sportText,
  type ReviewModel,
  type SportSource,
  type VideoSport,
} from "../../domain/video-constants";
import { localDate } from "../../domain/time";
import type { DbOrTx } from "../db/client";
import { loadCalendar } from "../calendar/load";
import { getHomeTimeZone } from "../settings";
import { listTournaments } from "../tennis/load";
import { notify, type NotifyDeps } from "./notify";

// What each kind of notification says, and when it fires (intent 0004,
// PUSH-1, PUSH-4, PUSH-5). The dedup keys carry the state that matters, so
// the same event never notifies twice, whichever job notices it.

const CLASH_DAYS = 14;

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
    const id = await notify(
      db,
      {
        kind: "clash",
        dedupKey: `clash:${c.a}|${c.b}`,
        title: `Clash on ${dayLabel(first.start, cal.homeTimeZone)}`,
        body:
          first.allDay || second.allDay
            ? `${first.title} and ${second.title}`
            : `${first.title} (${timeLabel(first.start, cal.homeTimeZone)}) and ${second.title} (${timeLabel(second.start, cal.homeTimeZone)})`,
        target: `events/${first.id}`,
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

// TEN-10: from the reserve list into the main draw, or off the entry list.
export async function notifyEntryChange(
  db: DbOrTx,
  before: EntryBefore,
  after: string,
  deps: NotifyDeps = {},
) {
  if (after === before.status) return;
  const inDraw = before.status === "reserve" && after === "main_draw";
  const gone = after === "withdrawn";
  if (!inDraw && !gone) return;
  await notify(
    db,
    {
      kind: "entry_change",
      dedupKey: `entry:${before.id}:${after}`,
      title: inDraw ? "In the main draw" : "Off the entry list",
      body: inDraw
        ? `${before.tournamentName} (${before.eventName}): moved from the reserve list into the main draw.`
        : `${before.tournamentName} (${before.eventName}): he's no longer on the entry list.`,
      target: "tennis",
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
    winner: ReviewModel | null;
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
      body:
        r.status === "done"
          ? `${what}${r.winner ? `: ${MODEL_LABEL[r.winner]}'s review won` : ""}.`
          : `${what}: ${r.error ?? "it failed"}`,
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
