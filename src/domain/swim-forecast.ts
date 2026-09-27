// Swim time forecast (SWM-5, spec §6.2, plan M2.6).
//
// Model: time(s) = c + b·e^(−k·s), where s is years since the first swim in
// the series. c is the asymptote the times approach; b ≥ 0 is how much
// faster there is to go; k sets how quickly improvement slows. The spec fits
// against age; age is s plus a constant, which only rescales b, so the fit
// is the same and no birth date is needed.
//
// Fitting: every timed swim of one event and course, with a Huber loss
// (iteratively reweighted least squares) so an off day doesn't drag the
// curve. For each k on a grid (half-lives from 3 months to 5 years), c and b
// have a closed-form weighted solution; the k with the lowest loss wins.
//
// Guardrails (§6.2): at least 4 swims over at least 6 months; the projection
// and its range are never faster than the asymptote; callers always label
// it "Estimate" and say growth spurts make it uncertain.

export type ForecastInput = { swimDate: string; timeMs: number }[];

export type ForecastPoint = { months: number; date: string; timeMs: number; lowMs: number; highMs: number };

export type Forecast =
  | {
      status: "ok";
      asymptoteMs: number;
      points: ForecastPoint[];
      // The fitted curve from the first swim to the last projection, for charts.
      curve: { date: string; timeMs: number }[];
      swims: number;
      spreadMs: number;
    }
  | { status: "insufficient"; reason: string };

export const MIN_SWIMS = 4;
export const MIN_SPAN_DAYS = 182;
const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;
const HORIZONS = [6, 12];
// 90% range.
const Z = 1.645;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const dateOf = (day: number) => new Date(Math.round(day) * DAY_MS).toISOString().slice(0, 10);

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const mad = (xs: number[]) => {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
};

const huber = (r: number, delta: number) =>
  Math.abs(r) <= delta ? 0.5 * r * r : delta * (Math.abs(r) - 0.5 * delta);

type Fit = { c: number; b: number; k: number; loss: number; residuals: number[] };

// Weighted least squares for t = c + b·x with b ≥ 0.
function solve(x: number[], t: number[], w: number[]): { c: number; b: number } {
  let sw = 0,
    sx = 0,
    st = 0,
    sxx = 0,
    sxt = 0;
  for (let i = 0; i < x.length; i++) {
    sw += w[i];
    sx += w[i] * x[i];
    st += w[i] * t[i];
    sxx += w[i] * x[i] * x[i];
    sxt += w[i] * x[i] * t[i];
  }
  const det = sw * sxx - sx * sx;
  const mean = st / sw;
  if (Math.abs(det) < 1e-12) return { c: mean, b: 0 };
  const b = (sw * sxt - sx * st) / det;
  if (b <= 0) return { c: mean, b: 0 };
  return { c: (st - b * sx) / sw, b };
}

function fitAt(s: number[], t: number[], k: number, delta: number): Fit {
  const x = s.map((v) => Math.exp(-k * v));
  let w = t.map(() => 1);
  let c = 0,
    b = 0;
  for (let iter = 0; iter < 20; iter++) {
    ({ c, b } = solve(x, t, w));
    const r = t.map((ti, i) => ti - (c + b * x[i]));
    w = r.map((ri) => (Math.abs(ri) <= delta ? 1 : delta / Math.abs(ri)));
  }
  const residuals = t.map((ti, i) => ti - (c + b * x[i]));
  return { c, b, k, residuals, loss: residuals.reduce((sum, r) => sum + huber(r, delta), 0) };
}

export function fitSeries(series: ForecastInput): Fit & { start: number } {
  const sorted = [...series].sort((a, b) => a.swimDate.localeCompare(b.swimDate));
  const start = dayNumber(sorted[0].swimDate);
  const s = sorted.map((p) => (dayNumber(p.swimDate) - start) / YEAR_DAYS);
  const t = sorted.map((p) => p.timeMs);
  // One scale for every k, so their losses compare: the spread around a
  // straight-line trend, floored at 0.5% of the typical time.
  const n = s.length;
  const ms = s.reduce((a, v) => a + v, 0) / n;
  const mt = t.reduce((a, v) => a + v, 0) / n;
  const slope =
    s.reduce((a, v, i) => a + (v - ms) * (t[i] - mt), 0) / (s.reduce((a, v) => a + (v - ms) ** 2, 0) || 1);
  const scale = Math.max(mad(t.map((ti, i) => ti - (mt + slope * (s[i] - ms)))), 0.005 * median(t));
  const delta = 1.345 * scale;

  let best: Fit | null = null;
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const halfLife = 0.25 * Math.pow(5 / 0.25, i / steps); // 3 months … 5 years
    const fit = fitAt(s, t, Math.LN2 / halfLife, delta);
    // The asymptote must be a real, positive time.
    if (!(fit.c > 0)) continue;
    if (!best || fit.loss < best.loss) best = fit;
  }
  if (!best) {
    // No positive asymptote on the grid: no improvement to project.
    const c = median(t);
    const residuals = t.map((ti) => ti - c);
    best = { c, b: 0, k: Math.LN2, residuals, loss: residuals.reduce((sum, r) => sum + huber(r, delta), 0) };
  }
  return { ...best, start };
}

type Model = ReturnType<typeof fitSeries> & { spread: number; lastDay: number; spanYears: number };

function model(series: ForecastInput): Model {
  const fit = fitSeries(series);
  const days = series.map((p) => dayNumber(p.swimDate));
  return {
    ...fit,
    // Three fitted numbers leave small residuals on a short series; the
    // √(n/(n−3)) correction widens the spread to allow for that, and it's
    // never taken as less than 1% of his typical time.
    spread: Math.max(
      mad(fit.residuals) * Math.sqrt(series.length / Math.max(1, series.length - 3)),
      0.01 * median(series.map((p) => p.timeMs)),
    ),
    lastDay: Math.max(...days),
    spanYears: (Math.max(...days) - Math.min(...days)) / YEAR_DAYS,
  };
}

// The projection for one day: the curve, and a range that widens the
// further past the data it reaches, never faster than the asymptote.
function project(m: Model, day: number): { centre: number; low: number; high: number } {
  const centre = m.c + m.b * Math.exp((-m.k * (day - m.start)) / YEAR_DAYS);
  const reach = Math.max(0, (day - m.lastDay) / YEAR_DAYS);
  const half = Z * m.spread * Math.sqrt(1 + reach / m.spanYears);
  return { centre, low: Math.max(m.c, centre - half), high: centre + half };
}

export function forecast(series: ForecastInput, today: string): Forecast {
  const valid = series.filter((p) => Number.isFinite(p.timeMs) && p.timeMs > 0);
  if (valid.length < MIN_SWIMS)
    return { status: "insufficient", reason: `Needs at least ${MIN_SWIMS} swims (has ${valid.length}).` };
  const days = valid.map((p) => dayNumber(p.swimDate));
  const spanDays = Math.max(...days) - Math.min(...days);
  if (spanDays < MIN_SPAN_DAYS)
    return { status: "insufficient", reason: "Needs swims spread over at least 6 months." };

  const m = model(valid);
  const points = HORIZONS.map((months) => {
    const date = addMonths(today, months);
    const p = project(m, dayNumber(date));
    return {
      months,
      date,
      timeMs: Math.round(p.centre),
      lowMs: Math.round(p.low),
      highMs: Math.round(p.high),
    };
  });
  const first = Math.min(...days);
  const last = dayNumber(points[points.length - 1].date);
  const curve = Array.from({ length: 41 }, (_, i) => {
    const day = first + ((last - first) * i) / 40;
    return { date: dateOf(day), timeMs: Math.round(project(m, day).centre) };
  });
  return {
    status: "ok",
    asymptoteMs: Math.round(m.c),
    points,
    curve,
    swims: valid.length,
    spreadMs: Math.round(m.spread),
  };
}

export type BacktestRow = {
  event: string;
  date: string;
  actualMs: number;
  predictedMs: number;
  inRange: boolean;
};

// Refit on the swims before each later swim and compare the projection
// for that swim's date with what he actually swam (plan M2.6 backtest).
export function backtest(events: Map<string, ForecastInput>): {
  rows: BacktestRow[];
  medianAbsPct: number | null;
  coverage: number | null;
} {
  const rows: BacktestRow[] = [];
  for (const [event, series] of events) {
    const sorted = [...series].sort((a, b) => a.swimDate.localeCompare(b.swimDate));
    for (let i = MIN_SWIMS; i < sorted.length; i++) {
      const past = sorted.slice(0, i).filter((p) => p.swimDate < sorted[i].swimDate);
      const days = past.map((p) => dayNumber(p.swimDate));
      if (past.length < MIN_SWIMS || Math.max(...days) - Math.min(...days) < MIN_SPAN_DAYS) continue;
      const p = project(model(past), dayNumber(sorted[i].swimDate));
      const actual = sorted[i].timeMs;
      rows.push({
        event,
        date: sorted[i].swimDate,
        actualMs: actual,
        predictedMs: Math.round(p.centre),
        inRange: actual >= p.low && actual <= p.high,
      });
    }
  }
  if (!rows.length) return { rows, medianAbsPct: null, coverage: null };
  return {
    rows,
    medianAbsPct: median(rows.map((r) => (Math.abs(r.predictedMs - r.actualMs) / r.actualMs) * 100)),
    coverage: rows.filter((r) => r.inRange).length / rows.length,
  };
}
