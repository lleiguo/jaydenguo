import type { MatchOutcome } from "./tennis-constants";
import type { SetScore } from "./tennis-upsert";

// Tennis read-side rules (TEN-4, TEN-5, TEN-7), pure so they're unit
// tested: whose side is whose, results and scores from one player's point
// of view, head-to-head, form and a running W–L.

// A player as the pages know them. `key` is the member number when there
// is one (so the same player from two sources is one person), else the
// row's id.
export type PlayerRef = { key: string; name: string };

export type TennisMatch = {
  id: string;
  matchDate: string;
  scheduledAt: string | null;
  tournamentId: string | null;
  tournamentName: string | null;
  eventName: string | null;
  round: string | null;
  sides: [PlayerRef[], PlayerRef[]];
  winner: 1 | 2 | null;
  sets: SetScore[];
  outcome: MatchOutcome;
};

export type Perspective = {
  side: 1 | 2;
  partner: PlayerRef | null;
  opponents: PlayerRef[];
  result: "W" | "L" | null;
  // Games from this player's side first: "6–3 4–6 [10–8]".
  score: string;
};

export const isSingles = (m: Pick<TennisMatch, "sides">) =>
  m.sides[0].length === 1 && m.sides[1].length === 1;

export function sideOf(m: Pick<TennisMatch, "sides">, key: string): 1 | 2 | null {
  if (m.sides[0].some((p) => p.key === key)) return 1;
  if (m.sides[1].some((p) => p.key === key)) return 2;
  return null;
}

// A deciding match tie-break (a third "set" to 7 or 10 after one set
// each) is shown in brackets.
export function formatScore(sets: SetScore[], side: 1 | 2 = 1): string {
  return sets
    .map(([a, b], i) => {
      const [x, y] = side === 1 ? [a, b] : [b, a];
      const tiebreak = i === 2 && Math.max(a, b) >= 10 && Math.abs(a - b) >= 2;
      return tiebreak ? `[${x}–${y}]` : `${x}–${y}`;
    })
    .join(" ");
}

export function outcomeNote(outcome: MatchOutcome): string | null {
  return outcome === "walkover" ? "walkover" : outcome === "retired" ? "retired" : null;
}

export function perspective(m: TennisMatch, key: string): Perspective | null {
  const side = sideOf(m, key);
  if (!side) return null;
  const mine = m.sides[side - 1];
  const theirs = m.sides[2 - side];
  const note = outcomeNote(m.outcome);
  const score = [formatScore(m.sets, side), note ? `(${note})` : ""].filter(Boolean).join(" ");
  return {
    side,
    partner: mine.find((p) => p.key !== key) ?? null,
    opponents: theirs,
    result: m.winner === null ? null : m.winner === side ? "W" : "L",
    score,
  };
}

// First of (a set of) keys this match involves, for a player known under
// several keys (him, across sources).
export function perspectiveAny(m: TennisMatch, keys: Set<string>): Perspective | null {
  for (const p of [...m.sides[0], ...m.sides[1]]) if (keys.has(p.key)) return perspective(m, p.key);
  return null;
}

const byDateDesc = (a: TennisMatch, b: TennisMatch) =>
  b.matchDate.localeCompare(a.matchDate) || (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? "");

export type WinLoss = { wins: number; losses: number };

export function record(results: ("W" | "L" | null)[]): WinLoss {
  return {
    wins: results.filter((r) => r === "W").length,
    losses: results.filter((r) => r === "L").length,
  };
}

export const formatRecord = (r: WinLoss) => `${r.wins}–${r.losses}`;

// TEN-4: every singles meeting between the two, newest first.
export function headToHead<M extends TennisMatch>(matches: M[], selfKeys: Set<string>, opponentKey: string) {
  const meetings = matches
    .filter(
      (m) =>
        isSingles(m) &&
        m.outcome !== "scheduled" &&
        sideOf(m, opponentKey) !== null &&
        perspectiveAny(m, selfKeys) !== null,
    )
    .sort(byDateDesc)
    .map((m) => ({ match: m, view: perspectiveAny(m, selfKeys)! }));
  return { meetings, record: record(meetings.map((x) => x.view.result)) };
}

// TEN-5: a player's last 10 decided singles matches, and their win rate
// over the 12 months before `today`.
export function form<M extends TennisMatch>(matches: M[], key: string, today: string, n = 10) {
  const decided = matches
    .filter((m) => isSingles(m) && m.winner !== null && sideOf(m, key) !== null && m.matchDate <= today)
    .sort(byDateDesc);
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const lastYear = record(
    decided.filter((m) => m.matchDate > yearAgo).map((m) => perspective(m, key)!.result),
  );
  const played = lastYear.wins + lastYear.losses;
  return {
    last: decided.slice(0, n).map((m) => ({ match: m, view: perspective(m, key)! })),
    lastYear,
    winRate: played ? lastYear.wins / played : null,
  };
}

// TEN-11: how experienced a player is, for the next-match card: the
// tournaments and decided singles matches found for them over the 12
// months before `today` (one hop, so only as complete as their profile).
export function level<M extends TennisMatch>(matches: M[], key: string, today: string) {
  const f = form(matches, key, today);
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const tournaments = new Set(
    matches
      .filter(
        (m) => sideOf(m, key) !== null && m.matchDate > yearAgo && m.matchDate <= today && m.tournamentId,
      )
      .map((m) => m.tournamentId),
  );
  return { tournaments: tournaments.size, lastYear: f.lastYear };
}

// TEN-7: seasons are calendar years, as the tournament site groups them.
export const seasonOf = (date: string) => Number(date.slice(0, 4));

// TEN-7: his matches oldest first with the W–L after each, then returned
// newest first for display.
export function withRunningRecord<T extends { view: Perspective; match: TennisMatch }>(rows: T[]) {
  const asc = [...rows].sort((a, b) => -byDateDesc(a.match, b.match));
  let wins = 0;
  let losses = 0;
  const out = asc.map((r) => {
    if (r.view.result === "W") wins++;
    if (r.view.result === "L") losses++;
    return { ...r, running: { wins, losses } };
  });
  return out.reverse();
}

// A score as the owner types it, games from his side first: "6-3 4-6 10-8"
// or "6–3, 4–6, [10–8]". Null when it can't be read.
export function parseSets(text: string): SetScore[] | null {
  const parts = text
    .replace(/[[\]()]/g, " ")
    .split(/[,\s]+/)
    .filter(Boolean);
  const sets: SetScore[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d{1,2})\s*[-–:/]\s*(\d{1,2})$/);
    if (!m) return null;
    sets.push([Number(m[1]), Number(m[2])]);
  }
  return sets.length <= 5 ? sets : null;
}

export const flipSets = (sets: SetScore[]): SetScore[] => sets.map(([a, b]) => [b, a]);

// "Guo, Jayden" or "Jayden Guo" → "Jayden", for headings.
export function firstName(name: string | null | undefined): string | null {
  const n = name?.trim();
  if (!n) return null;
  const first = n.includes(",") ? n.split(",")[1].trim().split(/\s+/)[0] : n.split(/\s+/)[0];
  return first || null;
}
