import { and, eq, isNull } from "drizzle-orm";
import { tennisTestNow } from "../../adapters/tennis-tc";
import { tennisDraws, tennisMatches, tennisPlayers, tennisTournaments } from "@db/schema";
import {
  level,
  form,
  headToHead,
  isSingles,
  perspectiveAny,
  record,
  seasonOf,
  withRunningRecord,
  type PlayerRef,
  type TennisMatch,
} from "../../domain/tennis";
import type { MatchOutcome } from "../../domain/tennis-constants";
import {
  backtest,
  buildModel,
  predict,
  ratedResults,
  whyLine,
  type Model,
  type Prediction,
} from "../../domain/tennis-predict";
import type { NextMatch } from "../../domain/tennis-draw";
import type { SetScore, TennisMatchValues } from "../../domain/tennis-upsert";
import { localDate } from "../../domain/time";
import type { DbOrTx } from "../db/client";
import { getHomeTimeZone } from "../settings";

// Read models for the tennis pages and /api/v1/tennis (TEN-2..5, TEN-7).
// Everything is worked out in memory from the stored matches: a few
// thousand rows at most (his matches and his opponents' last two years).

export type MatchView = TennisMatch & {
  drawNo: string | null;
  origin: "source" | "manual";
  corrected: boolean;
  sourceDisagrees: boolean;
  notes: string | null;
  // What the site says, when it disagrees with the owner's correction;
  // null when the site no longer lists the match.
  source: Pick<TennisMatchValues, "winner" | "sets" | "outcome" | "scheduledAt"> | null;
};

export type TennisPlayerView = {
  key: string;
  name: string;
  club: string | null;
  isSelf: boolean;
  profileUrl: string | null;
};

export type DrawView = {
  id: string;
  eventName: string | null;
  drawName: string | null;
  kind: "bracket" | "other";
  size: number | null;
  position: number | null;
  seed: string | null;
  status: "active" | "withdrawn";
  next: NextMatch | null;
  // The next opponent's page, when known.
  opponentKey: string | null;
  sourceUrl: string | null;
};

export type TournamentView = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  city: string | null;
  region: string | null;
  entryDeadline: string | null;
  categories: string[];
  sourceUrl: string | null;
  manual: boolean;
  when: "upcoming" | "in_progress" | "past";
  // TEN-2: the draws he's in and where his entry stands.
  draws: DrawView[];
  events: string[];
  entryStatus: string;
  record: { wins: number; losses: number };
};

export type TennisData = {
  today: string;
  timeZone: string;
  selfKeys: Set<string>;
  self: TennisPlayerView | null;
  players: Map<string, TennisPlayerView>;
  matches: MatchView[];
  tournaments: TournamentView[];
};

// Keeps the key in URLs short and stable: the member number, else the id.
const keyOf = (p: { id: string; memberId: string | null }) => p.memberId ?? p.id;

export async function loadTennis(db: DbOrTx): Promise<TennisData> {
  const timeZone = await getHomeTimeZone(db);
  const today = localDate(tennisTestNow() ?? new Date(), timeZone);
  const [playerRows, matchRows, tournamentRows, drawRows] = await Promise.all([
    db.select().from(tennisPlayers),
    db
      .select()
      .from(tennisMatches)
      .where(and(eq(tennisMatches.status, "active"), isNull(tennisMatches.deletedAt))),
    db
      .select()
      .from(tennisTournaments)
      .where(and(eq(tennisTournaments.status, "active"), isNull(tennisTournaments.deletedAt))),
    db.select().from(tennisDraws),
  ]);

  const players = new Map<string, TennisPlayerView>();
  const refById = new Map<string, PlayerRef>();
  const byMember = new Map(playerRows.filter((p) => p.memberId).map((p) => [p.memberId!, p]));
  for (const p of playerRows) {
    const key = keyOf(p);
    refById.set(p.id, { key, name: p.name });
    const had = players.get(key);
    // The row read from the player's own profile wins.
    if (!had || p.isSelf || (p.profileFetchedAt && !had.club)) {
      players.set(key, {
        key,
        name: p.name,
        club: p.club ?? had?.club ?? null,
        isSelf: p.isSelf || !!had?.isSelf,
        profileUrl: p.profileId ? `https://tc.tournamentsoftware.com/player-profile/${p.profileId}` : null,
      });
    }
  }
  const selfKeys = new Set(playerRows.filter((p) => p.isSelf).map(keyOf));
  const selfKey = [...selfKeys][0];
  const tournamentName = new Map(tournamentRows.map((t) => [t.id, t.name]));

  const ref = (id: string | null) => (id ? refById.get(id)! : null);
  const matches: MatchView[] = matchRows.map((m) => {
    const side = (a: string, b: string | null) => [ref(a)!, ...(b ? [ref(b)!] : [])];
    const source = m.sourceValues as TennisMatchValues | null;
    return {
      id: m.id,
      matchDate: m.matchDate,
      scheduledAt: m.scheduledAt?.toISOString() ?? null,
      tournamentId: m.tournamentId,
      tournamentName: m.tournamentId ? (tournamentName.get(m.tournamentId) ?? null) : null,
      eventName: m.eventName,
      round: m.round,
      drawNo: m.drawNo,
      sides: [side(m.side1, m.side1Partner), side(m.side2, m.side2Partner)],
      winner: (m.winner ?? null) as 1 | 2 | null,
      sets: (m.sets ?? []) as SetScore[],
      outcome: m.outcome as MatchOutcome,
      origin: m.origin as "source" | "manual",
      corrected: m.correctedAt !== null,
      sourceDisagrees: m.sourceDisagrees,
      notes: m.notes,
      source: source
        ? {
            winner: source.winner,
            sets: source.sets,
            outcome: source.outcome,
            scheduledAt: source.scheduledAt,
          }
        : null,
    };
  });

  const mineByTournament = new Map<string, MatchView[]>();
  for (const m of matches) {
    if (!m.tournamentId || !perspectiveAny(m, selfKeys)) continue;
    mineByTournament.set(m.tournamentId, [...(mineByTournament.get(m.tournamentId) ?? []), m]);
  }
  const tournaments: TournamentView[] = tournamentRows
    .filter((t) => t.entered || mineByTournament.has(t.id))
    .map((t) => {
      const mine = mineByTournament.get(t.id) ?? [];
      const draws: DrawView[] = drawRows
        .filter((d) => d.tournamentId === t.id)
        .map((d) => {
          const next = (d.nextMatch ?? null) as NextMatch | null;
          const opponent = next?.status === "next" ? next.opponent : null;
          return {
            id: d.id,
            eventName: d.eventName,
            drawName: d.drawName,
            kind: d.kind as DrawView["kind"],
            size: d.size,
            position: d.position,
            seed: d.seed,
            status: d.status as DrawView["status"],
            next,
            opponentKey: opponent?.memberId && byMember.has(opponent.memberId) ? opponent.memberId : null,
            sourceUrl: d.sourceUrl,
          };
        });
      const when = t.startDate > today ? "upcoming" : t.endDate < today ? "past" : "in_progress";
      const active = draws.filter((d) => d.status === "active");
      const events = [
        ...new Set([
          ...active.map((d) => d.eventName ?? d.drawName ?? "Draw"),
          ...mine.map((m) => m.eventName).filter((e): e is string => !!e),
        ]),
      ];
      const withdrawn = draws.length > 0 && !active.length;
      const entryStatus = withdrawn
        ? "Withdrawn"
        : when === "past"
          ? mine.length
            ? "Played"
            : "Entered"
          : active.length
            ? "In the draw"
            : when === "upcoming"
              ? "Entered; draw not published yet"
              : "Entered";
      return {
        id: t.id,
        name: t.name,
        startDate: t.startDate,
        endDate: t.endDate,
        venue: t.venue,
        city: t.city,
        region: t.region,
        entryDeadline: t.entryDeadline,
        categories: t.categories,
        sourceUrl: t.sourceUrl,
        manual: t.sourceId === null,
        when,
        draws,
        events,
        entryStatus,
        record: record(mine.map((m) => perspectiveAny(m, selfKeys)!.result)),
      };
    });

  return {
    today,
    timeZone,
    selfKeys,
    self: selfKey ? players.get(selfKey)! : null,
    players,
    matches,
    tournaments,
  };
}

const byStart = (a: TournamentView, b: TournamentView) => a.startDate.localeCompare(b.startDate);

// TEN-2 and TEN-3: tournaments by when they are, and his next matches.
export async function listTournaments(db: DbOrTx) {
  const data = await loadTennis(db);
  const { tournaments } = data;
  const nextMatches = tournaments
    .filter((t) => t.when !== "past")
    .flatMap((t) =>
      t.draws
        .filter((d) => d.status === "active" && d.next?.status === "next")
        .map((d) => ({ tournament: { id: t.id, name: t.name }, draw: d })),
    );
  return {
    data,
    today: data.today,
    self: data.self,
    nextMatches,
    inProgress: tournaments.filter((t) => t.when === "in_progress").sort(byStart),
    upcoming: tournaments.filter((t) => t.when === "upcoming").sort(byStart),
    past: tournaments.filter((t) => t.when === "past").sort((a, b) => -byStart(a, b)),
  };
}

export async function loadTournament(db: DbOrTx, id: string) {
  const data = await loadTennis(db);
  const tournament = data.tournaments.find((t) => t.id === id);
  if (!tournament) return null;
  const matches = data.matches
    .filter((m) => m.tournamentId === id)
    .map((m) => ({ match: m, view: perspectiveAny(m, data.selfKeys) }))
    .filter((x): x is { match: MatchView; view: NonNullable<typeof x.view> } => x.view !== null)
    .sort(
      (a, b) =>
        a.match.matchDate.localeCompare(b.match.matchDate) ||
        (a.match.scheduledAt ?? "").localeCompare(b.match.scheduledAt ?? ""),
    );
  return { data, tournament, matches };
}

// TEN-4 and TEN-5: one opponent, their meetings with him and their form.
export async function loadPlayer(db: DbOrTx, key: string) {
  const data = await loadTennis(db);
  const player = data.players.get(key);
  if (!player) return null;
  const h2h = headToHead(data.matches, data.selfKeys, key);
  const recent = form(data.matches, key, data.today);
  const upcoming = data.tournaments
    .filter((t) => t.when !== "past")
    .flatMap((t) =>
      t.draws
        .filter((d) => d.status === "active" && d.opponentKey === key)
        .map((d) => ({ tournament: { id: t.id, name: t.name }, draw: d })),
    );
  return { data, player, h2h, form: recent, upcoming };
}

// TEN-7: all his matches, a season filter, and a running W–L.
export async function loadResults(db: DbOrTx, season: number | null) {
  const data = await loadTennis(db);
  const mine = data.matches
    .map((m) => ({ match: m, view: perspectiveAny(m, data.selfKeys) }))
    .filter((x): x is { match: MatchView; view: NonNullable<typeof x.view> } => x.view !== null)
    .filter((x) => x.match.outcome !== "scheduled");
  const seasons = [...new Set(mine.map((x) => seasonOf(x.match.matchDate)))].sort((a, b) => b - a);
  const shown = season === null ? mine : mine.filter((x) => seasonOf(x.match.matchDate) === season);
  const rows = withRunningRecord(shown);
  return {
    data,
    seasons,
    season,
    rows,
    total: record(shown.map((x) => x.view.result)),
    singles: record(shown.filter((x) => isSingles(x.match)).map((x) => x.view.result)),
  };
}

// --- Predictions (TEN-6) ----------------------------------------------------

const SELF = "self";

// His rows (one per source, plus any typed in) count as one player.
function modelOf(data: TennisData) {
  const canon = (k: string) => (data.selfKeys.has(k) ? SELF : k);
  const results = ratedResults(data.matches, canon);
  return { results, model: buildModel(results) };
}

const models = new WeakMap<TennisData, Model>();
export type PredictionView = Prediction & {
  why: string;
  opponentKey: string;
  opponentName: string;
  // TEN-11: the opponent's last 12 months.
  opponentLevel: { tournaments: number; lastYear: { wins: number; losses: number } };
};

export function predictAgainst(data: TennisData, opponentKey: string): PredictionView | null {
  if (!data.self || data.selfKeys.has(opponentKey)) return null;
  let model = models.get(data);
  if (!model) {
    model = modelOf(data).model;
    models.set(data, model);
  }
  const opponent = data.players.get(opponentKey);
  const p = predict(model, SELF, opponentKey);
  const name = opponent?.name ?? "Opponent";
  return {
    ...p,
    why: whyLine(p, [data.self.name.split(" ")[0], name.split(" ")[0]]),
    opponentKey,
    opponentName: name,
    opponentLevel: level(data.matches, opponentKey, data.today),
  };
}

// "How accurate is this?": every decided singles match in the data set,
// predicted from what was known the month before.
export async function loadCalibration(db: DbOrTx) {
  const data = await loadTennis(db);
  return backtest(modelOf(data).results);
}
