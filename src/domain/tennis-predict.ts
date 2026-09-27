import { DEFAULT_RATING, expectedScore, ratePeriods, type RatedResult, type Rating } from "./glicko2";
import { isSingles, type TennisMatch } from "./tennis";

// Match prediction (TEN-6, spec §6.1). Glicko-2 ratings over every decided
// singles match in the data set give the base probability; head-to-head,
// recent form and margin of victory nudge it slightly on the log-odds
// scale. Confidence comes from how many rated matches each player has and
// how certain their ratings are. Pure; the backtest replays the data set
// to check calibration.

// How far each adjustment can move the log-odds at most. Small on purpose:
// the rating already reflects most of what these know.
const H2H_WEIGHT = 0.2;
const FORM_WEIGHT = 0.5;
const MARGIN_WEIGHT = 1.0;
const MAX_ADJUSTMENT = 0.6;
const FORM_N = 10;

export const PREDICT_VERSION = "tennis-predict-1";

type Played = { date: string; opponent: string; won: boolean; gamesFor: number; gamesAgainst: number };

export type Model = {
  ratings: Map<string, Rating>;
  history: Map<string, Played[]>; // oldest first
};

// Decided singles matches that were played (a walkover says nothing about
// the level of play). Players are mapped to one key each by `canon`.
export function ratedResults(matches: TennisMatch[], canon: (key: string) => string = (k) => k) {
  return matches
    .filter((m) => isSingles(m) && m.winner !== null && (m.outcome === "played" || m.outcome === "retired"))
    .map((m) => ({
      date: m.matchDate,
      a: canon(m.sides[0][0].key),
      b: canon(m.sides[1][0].key),
      winner: m.winner as 1 | 2,
      games: m.sets.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]),
    }))
    .filter((r) => r.a !== r.b)
    .sort((x, y) => x.date.localeCompare(y.date));
}
type Result = ReturnType<typeof ratedResults>[number];

const toRated = (r: Result): RatedResult => ({
  period: r.date.slice(0, 7),
  a: r.a,
  b: r.b,
  score: r.winner === 1 ? 1 : 0,
});

function addHistory(history: Map<string, Played[]>, r: Result) {
  const push = (k: string, p: Played) => history.set(k, [...(history.get(k) ?? []), p]);
  push(r.a, {
    date: r.date,
    opponent: r.b,
    won: r.winner === 1,
    gamesFor: r.games[0],
    gamesAgainst: r.games[1],
  });
  push(r.b, {
    date: r.date,
    opponent: r.a,
    won: r.winner === 2,
    gamesFor: r.games[1],
    gamesAgainst: r.games[0],
  });
}

// Ratings from every result before `before` (a date), or all of them.
export function buildModel(results: Result[], before?: string): Model {
  const used = before ? results.filter((r) => r.date < before) : results;
  const history = new Map<string, Played[]>();
  for (const r of used) addHistory(history, r);
  return { ratings: ratePeriods(used.map(toRated)), history };
}

export type Confidence = "low" | "medium" | "high";

export type Side = {
  rating: number;
  rd: number;
  ratedMatches: number;
  last: { wins: number; losses: number };
  gameShare: number | null;
};

export type Prediction = {
  version: string;
  probability: number; // that `a` wins
  base: number; // from the ratings alone
  adjustments: { headToHead: number; form: number; margin: number }; // log-odds
  confidence: Confidence;
  band: string;
  a: Side;
  b: Side;
  headToHead: { wins: number; losses: number };
};

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, m: number) => Math.max(-m, Math.min(m, x));

function side(model: Model, key: string): Side {
  const r = model.ratings.get(key) ?? DEFAULT_RATING;
  const h = model.history.get(key) ?? [];
  const last = h.slice(-FORM_N);
  const gf = last.reduce((s, p) => s + p.gamesFor, 0);
  const ga = last.reduce((s, p) => s + p.gamesAgainst, 0);
  return {
    rating: r.rating,
    rd: r.rd,
    ratedMatches: h.length,
    last: { wins: last.filter((p) => p.won).length, losses: last.filter((p) => !p.won).length },
    gameShare: gf + ga ? gf / (gf + ga) : null,
  };
}

export function confidenceOf(a: Side, b: Side): Confidence {
  if (Math.min(a.ratedMatches, b.ratedMatches) < 5 || Math.max(a.rd, b.rd) > 200) return "low";
  if (Math.min(a.ratedMatches, b.ratedMatches) >= 15 && Math.max(a.rd, b.rd) <= 110) return "high";
  return "medium";
}

// TEN-6's "likely score band", from the probability.
export function bandOf(p: number): string {
  if (p >= 0.8) return "Likely a straight-sets win";
  if (p >= 0.6) return "More likely a win; a third set is possible";
  if (p > 0.4) return "Close: likely to go to a third set";
  if (p > 0.2) return "More likely a loss; a third set is possible";
  return "Likely a straight-sets loss";
}

export function predict(model: Model, a: string, b: string): Prediction {
  const sa = side(model, a);
  const sb = side(model, b);
  const base = expectedScore(model.ratings.get(a) ?? DEFAULT_RATING, model.ratings.get(b) ?? DEFAULT_RATING);

  const meetings = (model.history.get(a) ?? []).filter((p) => p.opponent === b);
  const h2h = { wins: meetings.filter((p) => p.won).length, losses: meetings.filter((p) => !p.won).length };
  // Shrunk toward nothing: one meeting moves the odds very little.
  const headToHead = (H2H_WEIGHT * (h2h.wins - h2h.losses)) / (meetings.length + 3);
  const shrink = Math.min(sa.last.wins + sa.last.losses, sb.last.wins + sb.last.losses) / FORM_N;
  const rate = (s: Side) => (s.last.wins + s.last.losses ? s.last.wins / (s.last.wins + s.last.losses) : 0.5);
  const form = FORM_WEIGHT * (rate(sa) - rate(sb)) * shrink;
  const margin =
    sa.gameShare !== null && sb.gameShare !== null
      ? MARGIN_WEIGHT * (sa.gameShare - sb.gameShare) * shrink
      : 0;
  const total = clamp(headToHead + form + margin, MAX_ADJUSTMENT);
  const probability = Math.min(
    0.99,
    Math.max(0.01, sigmoid(logit(Math.min(0.99, Math.max(0.01, base))) + total)),
  );
  return {
    version: PREDICT_VERSION,
    probability,
    base,
    adjustments: { headToHead, form, margin },
    confidence: confidenceOf(sa, sb),
    band: bandOf(probability),
    a: sa,
    b: sb,
    headToHead: h2h,
  };
}

// The "why" line (TEN-6): the inputs, in words.
export function whyLine(p: Prediction, names: [string, string]): string {
  const r = (s: Side) => `${Math.round(s.rating)} ± ${Math.round(s.rd)}`;
  const parts = [`Ratings ${r(p.a)} vs ${r(p.b)}`];
  if (p.headToHead.wins + p.headToHead.losses)
    parts.push(`head-to-head ${p.headToHead.wins}–${p.headToHead.losses}`);
  const form = (s: Side) => `${s.last.wins}–${s.last.losses}`;
  parts.push(`last ${FORM_N}: ${names[0]} ${form(p.a)}, ${names[1]} ${form(p.b)}`);
  if (p.a.gameShare !== null && p.b.gameShare !== null)
    parts.push(`games won ${Math.round(p.a.gameShare * 100)}% vs ${Math.round(p.b.gameShare * 100)}%`);
  parts.push(`rated matches ${p.a.ratedMatches} vs ${p.b.ratedMatches}`);
  return parts.join(" · ");
}

// --- Backtest --------------------------------------------------------------

export type Bucket = { from: number; to: number; n: number; predicted: number; actual: number };
export type Backtest = {
  n: number;
  accuracy: number | null;
  brier: number | null;
  brierBase: number | null;
  logLoss: number | null;
  buckets: Bucket[];
  byConfidence: { confidence: Confidence; n: number; accuracy: number | null; brier: number | null }[];
};

// Replays the data set month by month: every match is predicted from the
// ratings and history before its month, then the month is rated. Nothing
// about a match is known when it is predicted.
export function backtest(results: Result[]): Backtest {
  const history = new Map<string, Played[]>();
  const rows: { p: number; base: number; won: 0 | 1; confidence: Confidence }[] = [];
  const byPeriod = new Map<string, Result[]>();
  for (const r of results) byPeriod.set(r.date.slice(0, 7), [...(byPeriod.get(r.date.slice(0, 7)) ?? []), r]);
  ratePeriods(results.map(toRated), (period, before) => {
    const games = byPeriod.get(period)!;
    const model: Model = { ratings: before, history };
    for (const r of games) {
      const p = predict(model, r.a, r.b);
      rows.push({ p: p.probability, base: p.base, won: r.winner === 1 ? 1 : 0, confidence: p.confidence });
    }
    for (const r of games) addHistory(history, r);
  });
  return summarise(rows);
}

function summarise(rows: { p: number; base: number; won: 0 | 1; confidence: Confidence }[]): Backtest {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  // Calibration is shown from the favourite's side: "called 70%".
  const fav = rows.map((r) => ({
    f: Math.max(r.p, 1 - r.p),
    won: (r.p >= 0.5 ? r.won : 1 - r.won) as 0 | 1,
  }));
  const edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const buckets: Bucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const inside = fav.filter((x) => x.f >= edges[i] && x.f < edges[i + 1]);
    buckets.push({
      from: edges[i],
      to: Math.min(1, edges[i + 1]),
      n: inside.length,
      predicted: mean(inside.map((x) => x.f)) ?? 0,
      actual: mean(inside.map((x) => x.won)) ?? 0,
    });
  }
  const accuracy = (xs: typeof rows) => mean(xs.map((r) => ((r.p >= 0.5 ? 1 : 0) === r.won ? 1 : 0)));
  const brier = (xs: typeof rows, pick: (r: (typeof rows)[number]) => number) =>
    mean(xs.map((r) => (pick(r) - r.won) ** 2));
  return {
    n: rows.length,
    accuracy: accuracy(rows),
    brier: brier(rows, (r) => r.p),
    brierBase: brier(rows, (r) => r.base),
    logLoss: mean(rows.map((r) => -Math.log(r.won ? r.p : 1 - r.p))),
    buckets,
    byConfidence: (["low", "medium", "high"] as const).map((c) => {
      const xs = rows.filter((r) => r.confidence === c);
      return { confidence: c, n: xs.length, accuracy: accuracy(xs), brier: brier(xs, (r) => r.p) };
    }),
  };
}
