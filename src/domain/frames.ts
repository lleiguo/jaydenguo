// Which moments of a clip Claude sees as frames (spec §6.3, plan M5.3):
// about 1.5 a second overall, and 12 a second in the one or two short
// windows with the most motion (the stroke or the turn), at most about 60.
// Motion is ffmpeg's scene-change score per sampled frame.

export type MotionSample = { t: number; score: number };

export type FrameOptions = {
  baseFps?: number;
  denseFps?: number;
  window?: number; // seconds
  cap?: number;
};

const DEFAULTS = { baseFps: 1.5, denseFps: 12, window: 1.2, cap: 60 };

const r3 = (x: number) => Math.round(x * 1000) / 1000;

// The start of the window of `length` seconds with the most motion, skipping
// windows that overlap `avoid`.
function busiestWindow(samples: MotionSample[], length: number, duration: number, avoid: [number, number][]) {
  let best: { start: number; sum: number } | null = null;
  for (const s of samples) {
    const start = Math.max(0, Math.min(s.t, duration - length));
    const end = start + length;
    if (avoid.some(([a, b]) => start < b && end > a)) continue;
    const sum = samples.filter((x) => x.t >= start && x.t < end).reduce((acc, x) => acc + x.score, 0);
    if (!best || sum > best.sum) best = { start, sum };
  }
  return best;
}

// Keeps `n` of `items`, evenly spread, always keeping the first and last.
function thin<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items;
  if (n <= 0) return [];
  if (n === 1) return [items[Math.floor(items.length / 2)]];
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]);
}

export function chooseFrameTimes(
  duration: number,
  motion: MotionSample[],
  options: FrameOptions = {},
): number[] {
  const o = { ...DEFAULTS, ...options };
  if (!(duration > 0)) return [];
  const last = Math.max(0, duration - 0.05);

  const windows: [number, number][] = [];
  if (duration <= o.window) windows.push([0, duration]);
  else {
    const first = busiestWindow(motion, o.window, duration, []);
    if (first && first.sum > 0) {
      windows.push([first.start, first.start + o.window]);
      const second = busiestWindow(motion, o.window, duration, windows);
      if (second && second.sum >= first.sum * 0.5) windows.push([second.start, second.start + o.window]);
    }
  }

  const inWindow = (t: number) => windows.some(([a, b]) => t >= a && t < b);
  const dense: number[] = [];
  for (const [a, b] of windows) for (let t = a; t < b && t <= last; t += 1 / o.denseFps) dense.push(r3(t));
  const base: number[] = [];
  for (let t = 0.1; t <= last; t += 1 / o.baseFps) if (!inWindow(t)) base.push(r3(t));

  // Over the cap: thin the overview first (keep at least a few), then the
  // dense windows.
  let keepDense = dense;
  let keepBase = base;
  if (keepDense.length + keepBase.length > o.cap) {
    keepBase = thin(base, Math.max(Math.min(base.length, 8), o.cap - dense.length));
    if (keepDense.length + keepBase.length > o.cap) keepDense = thin(dense, o.cap - keepBase.length);
  }
  return [...new Set([...keepDense, ...keepBase])].sort((a, b) => a - b);
}

// Frames per second to ask Gemini for (§6.3: faster for fast strokes), kept
// under about 400 sampled frames per clip.
export function geminiFps(sport: string, durationSec: number): number {
  const wanted = sport === "tennis" ? 8 : 4;
  return Math.max(1, Math.min(wanted, Math.floor(400 / Math.max(durationSec, 1))));
}
