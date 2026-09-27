// Glicko-2 (Mark Glickman, "Example of the Glicko-2 system", 2013), for
// TEN-6 and spec §6.1. Pure maths; tested against the paper's worked
// example (tests/unit/glicko2.test.ts).

export type Rating = { rating: number; rd: number; vol: number };
export type Game = { opponent: Rating; score: 0 | 0.5 | 1 };

export const DEFAULT_RATING: Rating = { rating: 1500, rd: 350, vol: 0.06 };
// The system constant: how much volatility can change. The paper suggests
// 0.3 to 1.2; 0.5 is its example.
export const TAU = 0.5;
const SCALE = 173.7178;
const EPSILON = 0.000001;

const toMu = (r: number) => (r - 1500) / SCALE;
const toPhi = (rd: number) => rd / SCALE;
const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const e = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

// One rating period for one player: their rating before it and the games
// they played in it (against opponents' ratings before it too).
export function updateRating(player: Rating, games: Game[], tau = TAU): Rating {
  const mu = toMu(player.rating);
  const phi = toPhi(player.rd);
  const sigma = player.vol;
  if (!games.length) {
    // Step 6 only: uncertainty grows while a player doesn't play.
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: Math.min(phiStar * SCALE, DEFAULT_RATING.rd), vol: sigma };
  }

  // Steps 3 and 4: estimated variance and improvement.
  let vInv = 0;
  let sum = 0;
  for (const game of games) {
    const muJ = toMu(game.opponent.rating);
    const phiJ = toPhi(game.opponent.rd);
    const gj = g(phiJ);
    const ej = e(mu, muJ, phiJ);
    vInv += gj * gj * ej * (1 - ej);
    sum += gj * (game.score - ej);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  // Step 5: new volatility (the Illinois algorithm).
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);

  // Steps 6 to 8: new deviation and rating.
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;
  return { rating: muNew * SCALE + 1500, rd: Math.min(phiNew * SCALE, DEFAULT_RATING.rd), vol: sigmaNew };
}

// The chance that `a` beats `b`. Both ratings' uncertainty counts, so two
// barely known players come out near 50%.
export function expectedScore(a: Rating, b: Rating): number {
  const phi = Math.sqrt(toPhi(a.rd) ** 2 + toPhi(b.rd) ** 2);
  return e(toMu(a.rating), toMu(b.rating), phi);
}

export type RatedResult = { period: string; a: string; b: string; score: 0 | 1 };

// Rates every player over a set of results, one rating period at a time
// (periods sort as strings, e.g. "2024-09"). `onPeriod` sees the ratings as
// they stood before each period's games, which is what the backtest uses.
export function ratePeriods(
  results: RatedResult[],
  onPeriod?: (period: string, before: Map<string, Rating>, results: RatedResult[]) => void,
): Map<string, Rating> {
  const ratings = new Map<string, Rating>();
  const get = (k: string) => ratings.get(k) ?? DEFAULT_RATING;
  const periods = [...new Set(results.map((r) => r.period))].sort();
  const byPeriod = new Map<string, RatedResult[]>();
  for (const r of results) byPeriod.set(r.period, [...(byPeriod.get(r.period) ?? []), r]);
  let last: string | null = null;
  for (const period of periods) {
    // Players who sat out the months in between grow less certain.
    if (last) {
      const gap = monthsBetween(last, period) - 1;
      for (let i = 0; i < gap; i++) for (const [k, r] of ratings) ratings.set(k, updateRating(r, []));
    }
    const games = byPeriod.get(period)!;
    onPeriod?.(period, ratings, games);
    const perPlayer = new Map<string, Game[]>();
    for (const r of games) {
      perPlayer.set(r.a, [...(perPlayer.get(r.a) ?? []), { opponent: get(r.b), score: r.score }]);
      perPlayer.set(r.b, [
        ...(perPlayer.get(r.b) ?? []),
        { opponent: get(r.a), score: (1 - r.score) as 0 | 1 },
      ]);
    }
    const next = new Map<string, Rating>();
    for (const [k, r] of ratings) if (!perPlayer.has(k)) next.set(k, updateRating(r, []));
    for (const [k, list] of perPlayer) next.set(k, updateRating(get(k), list));
    ratings.clear();
    for (const [k, r] of next) ratings.set(k, r);
    last = period;
  }
  return ratings;
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
