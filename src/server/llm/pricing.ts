// List prices per million tokens at build time (spikes.md SP-6), used to
// record what each call cost (plan M5.4). Check them against the Vertex AI
// pricing page when the bill arrives; a model not listed costs 0 here and
// is logged, so a new model can't silently hide its cost.

type Price = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

export const PRICES: Record<string, Price> = {
  // Thinking tokens are billed as output.
  "gemini-3.1-pro-preview": { input: 2, output: 12 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

export type Usage = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

export function priceKnown(model: string): boolean {
  return Object.hasOwn(PRICES, model);
}

export function costUsd(model: string, usage: Usage): number {
  const p = PRICES[model];
  if (!p) return 0;
  const cost =
    usage.input * p.input +
    usage.output * p.output +
    (usage.cacheRead ?? 0) * (p.cacheRead ?? p.input) +
    (usage.cacheWrite ?? 0) * (p.cacheWrite ?? p.input);
  return Math.round(cost / 100) / 10_000; // per million, to 4 decimals
}
