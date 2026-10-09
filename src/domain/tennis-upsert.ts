import { createHash } from "node:crypto";
import type { MatchOutcome } from "./tennis-constants";
import type { NextMatch } from "./tennis-draw";
import type { SyncWindow } from "./upsert";

// Sync rules for tennis (plan M3.3, M3.7; SYNC-3, TEN-8), as pure functions
// like src/domain/swim-upsert.ts. Nothing is deleted. A match the owner
// corrected or added by hand is never overwritten: sync only records the
// source's version next to it and flags the row when the two disagree.

export type TennisPlayerRecord = {
  memberId: string;
  name: string;
  club: string | null;
  profileId: string | null;
  isSelf: boolean;
  // This run read the player's own profile (not just their name in a match).
  profileFetched: boolean;
};

export type TennisTournamentRecord = {
  externalId: string;
  name: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  city: string | null;
  region: string | null;
  entryDeadline: string | null;
  categories: string[];
  entered: boolean;
  sourceUrl: string | null;
};

export type TennisDrawRecord = {
  tournamentExternalId: string;
  drawNo: string;
  eventName: string | null;
  drawName: string | null;
  kind: "bracket" | "other";
  size: number | null;
  position: number | null;
  seed: string | null;
  nextMatch: NextMatch | null;
  sourceUrl: string | null;
};

export type SetScore = [number, number];

// Players are referred to by member number, or `player:<id>` for players
// the owner typed in.
export type TennisMatchValues = {
  tournamentExternalId: string | null;
  drawNo: string | null;
  eventName: string | null;
  round: string | null;
  matchDate: string;
  scheduledAt: string | null; // ISO, UTC
  side1: string[];
  side2: string[];
  winner: 1 | 2 | null;
  sets: SetScore[];
  outcome: MatchOutcome;
};

export type TennisMatchRecord = TennisMatchValues & { externalId: string };

export type TennisBatch = {
  selfMemberId: string;
  players: TennisPlayerRecord[];
  tournaments: TennisTournamentRecord[];
  // Only for tournaments this run read the draws of.
  draws: TennisDrawRecord[];
  matches: TennisMatchRecord[];
  window: SyncWindow;
  // Set when this batch read only these tournaments (intent 0012, TPR-3):
  // nothing outside them is cancelled.
  scope?: string[];
};

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

export const tournamentHash = (t: TennisTournamentRecord) => hash(t);

export function matchValues(r: TennisMatchValues): TennisMatchValues {
  return {
    tournamentExternalId: r.tournamentExternalId,
    drawNo: r.drawNo,
    eventName: r.eventName,
    round: r.round,
    matchDate: r.matchDate,
    scheduledAt: r.scheduledAt,
    side1: r.side1,
    side2: r.side2,
    winner: r.winner,
    sets: r.sets,
    outcome: r.outcome,
  };
}

export const matchHash = (r: TennisMatchValues) => hash(matchValues(r));

// The external ID of a match: tournament, draw and the two sides. The same
// match seen from both players' profiles gets the same ID.
export function matchKey(
  tournamentId: string,
  drawOrEvent: string,
  side1: string[],
  side2: string[],
): string {
  const sides = [side1, side2].map((s) => [...s].sort().join("+")).sort();
  return `${tournamentId}:${drawOrEvent}:${sides.join(":")}`;
}

export const involves = (v: Pick<TennisMatchValues, "side1" | "side2">, key: string) =>
  v.side1.includes(key) || v.side2.includes(key);

// --- Tournaments ---------------------------------------------------------

export type StoredTournament = {
  id: string;
  externalId: string;
  status: "active" | "cancelled";
  entered: boolean;
  sourceHash: string | null;
  startDate: string;
};

export type TournamentPlanItem =
  | { op: "insert"; record: TennisTournamentRecord; hash: string }
  | { op: "update"; id: string; record: TennisTournamentRecord; hash: string }
  | { op: "cancel"; id: string };

export function planTournaments(
  stored: StoredTournament[],
  incoming: TennisTournamentRecord[],
  window: SyncWindow,
  scope?: string[],
): TournamentPlanItem[] {
  const byId = new Map(incoming.map((t) => [t.externalId, t]));
  const storedById = new Map(stored.map((s) => [s.externalId, s]));
  const items: TournamentPlanItem[] = [];
  for (const [externalId, record] of byId) {
    const h = tournamentHash(record);
    const existing = storedById.get(externalId);
    if (!existing) items.push({ op: "insert", record, hash: h });
    else if (existing.sourceHash !== h || existing.status === "cancelled")
      items.push({ op: "update", id: existing.id, record, hash: h });
  }
  // A tournament he was entered in that vanished from his profile is
  // cancelled (recent and future ones only), never on an empty fetch.
  // Tournaments only an opponent played are never cancelled: the crawl
  // doesn't read every opponent every run.
  if (incoming.some((t) => t.entered)) {
    const from = window.from?.toISOString().slice(0, 10);
    for (const s of stored) {
      if (scope && !scope.includes(s.externalId)) continue;
      if (s.status === "active" && s.entered && !byId.has(s.externalId) && (!from || s.startDate >= from))
        items.push({ op: "cancel", id: s.id });
    }
  }
  return items;
}

// --- Matches -------------------------------------------------------------

export type StoredMatch = {
  id: string;
  externalId: string | null;
  origin: "source" | "manual";
  status: "active" | "cancelled";
  deleted: boolean;
  corrected: boolean;
  sourceHash: string | null;
  sourceDisagrees: boolean;
  values: TennisMatchValues;
};

export type MatchFill = Partial<
  Pick<TennisMatchValues, "tournamentExternalId" | "drawNo" | "eventName" | "round" | "scheduledAt">
>;

export type MatchPlanItem =
  | { op: "insert"; record: TennisMatchRecord; hash: string }
  | {
      op: "update";
      id: string;
      before: TennisMatchValues;
      record: TennisMatchRecord;
      hash: string;
      restore: boolean;
    }
  | {
      op: "source";
      id: string;
      record: TennisMatchRecord | null;
      hash: string | null;
      disagrees: boolean;
      fill: MatchFill;
      link: boolean;
    }
  | { op: "cancel"; id: string; before: TennisMatchValues };

export type MatchPlan = {
  items: MatchPlanItem[];
  unchanged: string[];
  counts: { added: number; changed: number; cancelled: number };
};

const sameSets = (a: SetScore[], b: SetScore[]) =>
  a.length === b.length && a.every((s, i) => s[0] === b[i][0] && s[1] === b[i][1]);

// The owner's row and the source disagree when the outcome differs: who
// won, the score, walkover/retired, or the start time.
export function disagrees(row: TennisMatchValues, source: TennisMatchValues): boolean {
  return (
    row.winner !== source.winner ||
    row.outcome !== source.outcome ||
    !sameSets(row.sets, source.sets) ||
    (row.scheduledAt ?? null) !== (source.scheduledAt ?? null)
  );
}

function fillFor(row: TennisMatchValues, source: TennisMatchValues): MatchFill {
  const fill: MatchFill = {};
  for (const k of ["tournamentExternalId", "drawNo", "eventName", "round", "scheduledAt"] as const) {
    if (row[k] === null && source[k] !== null) (fill as Record<string, unknown>)[k] = source[k];
  }
  return fill;
}

// Same day, and the same players on the two sides (in either order). The
// owner's hand-typed opponent is matched by name in `sameOpponent`.
function sameMatch(
  manual: TennisMatchValues,
  source: TennisMatchValues,
  sameOpponent: (manualKey: string, sourceKey: string) => boolean,
): boolean {
  if (manual.matchDate !== source.matchDate) return false;
  const eq = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x) => b.some((y) => x === y || sameOpponent(x, y)));
  return (
    (eq(manual.side1, source.side1) && eq(manual.side2, source.side2)) ||
    (eq(manual.side1, source.side2) && eq(manual.side2, source.side1))
  );
}

export function planMatches(
  stored: StoredMatch[],
  incoming: TennisMatchRecord[],
  opts: {
    selfKey: string;
    window: SyncWindow;
    // Only these tournaments were read: matches elsewhere aren't cancelled.
    scope?: string[];
    sameOpponent?: (manualKey: string, sourceKey: string) => boolean;
  },
): MatchPlan {
  const sameOpponent = opts.sameOpponent ?? (() => false);
  const byId = new Map<string, TennisMatchRecord>();
  for (const r of incoming) byId.set(r.externalId, r);
  const storedById = new Map(stored.filter((s) => s.externalId).map((s) => [s.externalId!, s]));
  const unlinked = stored.filter(
    (s) => s.origin === "manual" && !s.externalId && !s.deleted && s.status === "active",
  );
  const items: MatchPlanItem[] = [];
  const unchanged: string[] = [];
  const counts = { added: 0, changed: 0, cancelled: 0 };

  for (const [externalId, record] of byId) {
    const h = matchHash(record);
    const existing = storedById.get(externalId);
    if (!existing) {
      const candidate = unlinked.find((m) => sameMatch(m.values, record, sameOpponent));
      if (candidate) {
        unlinked.splice(unlinked.indexOf(candidate), 1);
        items.push({
          op: "source",
          id: candidate.id,
          record,
          hash: h,
          disagrees: disagrees(candidate.values, record),
          fill: fillFor(candidate.values, record),
          link: true,
        });
        counts.changed++;
      } else {
        items.push({ op: "insert", record, hash: h });
        counts.added++;
      }
      continue;
    }
    if (existing.corrected || existing.origin === "manual") {
      const disagree = disagrees(existing.values, record);
      const fill = fillFor(existing.values, record);
      if (existing.sourceHash !== h || existing.sourceDisagrees !== disagree || Object.keys(fill).length) {
        items.push({
          op: "source",
          id: existing.id,
          record,
          hash: h,
          disagrees: disagree,
          fill,
          link: false,
        });
        counts.changed++;
      } else unchanged.push(externalId);
      continue;
    }
    if (existing.sourceHash !== h || existing.status === "cancelled") {
      items.push({
        op: "update",
        id: existing.id,
        before: existing.values,
        record,
        hash: h,
        restore: existing.status === "cancelled",
      });
      counts.changed++;
    } else unchanged.push(externalId);
  }

  // His matches the source stopped listing (recent and future only). An
  // empty fetch cancels nothing (NFR-6). Opponents' matches are never
  // cancelled: not every opponent is read every run.
  const incomingSelf = incoming.some((r) => involves(r, opts.selfKey));
  if (incomingSelf) {
    const from = opts.window.from?.toISOString().slice(0, 10);
    for (const s of stored) {
      if (!s.externalId || byId.has(s.externalId) || s.status !== "active") continue;
      if (!involves(s.values, opts.selfKey) || (from && s.values.matchDate < from)) continue;
      if (opts.scope && !opts.scope.includes(s.values.tournamentExternalId ?? "")) continue;
      if (s.corrected || s.origin === "manual") {
        if (s.sourceHash !== null || !s.sourceDisagrees)
          items.push({
            op: "source",
            id: s.id,
            record: null,
            hash: null,
            disagrees: true,
            fill: {},
            link: false,
          });
        continue;
      }
      items.push({ op: "cancel", id: s.id, before: s.values });
      counts.cancelled++;
    }
  }
  return { items, unchanged, counts };
}
