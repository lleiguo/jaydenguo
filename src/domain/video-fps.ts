// Frames per second to ask Gemini for (§6.3: faster for fast strokes), kept
// under about 400 sampled frames per clip.
export function geminiFps(sport: string, durationSec: number): number {
  const wanted = sport === "tennis" ? 8 : 4;
  return Math.max(1, Math.min(wanted, Math.floor(400 / Math.max(durationSec, 1))));
}
