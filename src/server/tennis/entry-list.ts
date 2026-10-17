import { and, asc, eq, inArray } from "drizzle-orm";
import { tennisEntries, tennisEntryList, tennisPlayers, tennisTournaments } from "@db/schema";
import { nameTokens } from "../../domain/tennis-entry";
import type { DbOrTx } from "../db/client";
import { entryStatus, type UpcomingStatus } from "./upcoming";

// Intent 0017, ACC-5: one of his entries and its acceptance list as last
// read: the main draw, then the reserve list (with places).

export type EntryListPlayer = {
  names: string[];
  isSelf: boolean;
  // The player's page here, when the app knows them (one name, matched once).
  playerKey: string | null;
  reservePosition: number | null;
};

export type EntryListView = {
  id: string;
  tournamentName: string;
  eventName: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  status: UpcomingStatus;
  note: string | null;
  // The synced tournament's page, once there is one.
  tournamentId: string | null;
  tournamentUrl: string;
  // When the list was last read; null before any read.
  listCheckedAt: string | null;
  // False until the list shows main draw or reserve places.
  listOut: boolean;
  mainDraw: EntryListPlayer[];
  reserve: EntryListPlayer[];
};

type EntryRow = typeof tennisEntries.$inferSelect;

async function views(db: DbOrTx, entries: EntryRow[]): Promise<EntryListView[]> {
  if (!entries.length) return [];
  const [rows, players, tournaments] = await Promise.all([
    db
      .select()
      .from(tennisEntryList)
      .where(
        inArray(
          tennisEntryList.entryId,
          entries.map((e) => e.id),
        ),
      )
      .orderBy(asc(tennisEntryList.position)),
    db.select().from(tennisPlayers),
    db
      .select({
        id: tennisTournaments.id,
        sourceId: tennisTournaments.sourceId,
        externalId: tennisTournaments.externalId,
      })
      .from(tennisTournaments)
      .where(eq(tennisTournaments.status, "active")),
  ]);
  const self = players.filter((p) => p.isSelf).map((p) => nameTokens(p.name));
  // Known players by name; a name two players share links to neither.
  const byName = new Map<string, string | null>();
  for (const p of players) {
    const k = nameTokens(p.name);
    const key = p.memberId ?? p.id;
    byName.set(k, byName.has(k) && byName.get(k) !== key ? null : key);
  }
  return entries.map((e) => {
    const list = rows.filter((r) => r.entryId === e.id);
    const player = (r: (typeof list)[number]): EntryListPlayer => {
      const isSelf =
        (!!e.tournamentPlayerId && r.tournamentPlayerIds.includes(e.tournamentPlayerId)) ||
        (r.names.length === 1 && self.includes(nameTokens(r.names[0])));
      return {
        names: r.names,
        isSelf,
        playerKey: !isSelf && r.names.length === 1 ? (byName.get(nameTokens(r.names[0])) ?? null) : null,
        reservePosition: r.reservePosition,
      };
    };
    const tournament = tournaments.find(
      (t) => t.sourceId === e.sourceId && t.externalId === e.tournamentExternalId,
    );
    return {
      id: e.id,
      tournamentName: e.tournamentName,
      eventName: e.eventName,
      startDate: e.startDate,
      endDate: e.endDate,
      venue: [e.venue, e.city].filter(Boolean).join(", ") || null,
      status: entryStatus(e),
      note: e.note,
      tournamentId: tournament?.id ?? null,
      tournamentUrl: e.tournamentUrl,
      listCheckedAt: e.listCheckedAt?.toISOString() ?? null,
      listOut: list.some((r) => r.status === "main_draw" || r.status === "reserve"),
      mainDraw: list.filter((r) => r.status === "main_draw").map(player),
      reserve: list
        .filter((r) => r.status === "reserve")
        .map(player)
        .sort((a, b) => (a.reservePosition ?? Infinity) - (b.reservePosition ?? Infinity)),
    };
  });
}

export async function loadEntry(db: DbOrTx, id: string): Promise<EntryListView | null> {
  const [e] = await db.select().from(tennisEntries).where(eq(tennisEntries.id, id));
  return e ? ((await views(db, [e]))[0] ?? null) : null;
}

// His entries in one synced tournament, for its page.
export async function entriesForTournament(
  db: DbOrTx,
  t: { sourceId: string | null; externalId: string | null },
): Promise<EntryListView[]> {
  if (!t.sourceId || !t.externalId) return [];
  const entries = await db
    .select()
    .from(tennisEntries)
    .where(and(eq(tennisEntries.sourceId, t.sourceId), eq(tennisEntries.tournamentExternalId, t.externalId)))
    .orderBy(asc(tennisEntries.eventName));
  return views(
    db,
    entries.filter((e) =>
      ["entered", "payment_needed", "main_draw", "reserve", "withdrawn"].includes(e.status),
    ),
  );
}
