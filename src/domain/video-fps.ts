// Frames per second to ask Gemini for (§6.3: faster for fast strokes), kept
// under 900 sampled frames per clip (intent 0014, WVR-4).
export const MAX_GEMINI_FRAMES = 900;

export function geminiFps(sport: string, durationSec: number): number {
  const wanted = sport === "tennis" ? 8 : 4;
  return Math.max(1, Math.min(wanted, Math.floor(MAX_GEMINI_FRAMES / Math.max(durationSec, 1))));
}

// The frame rate of the clip Gemini gets: the most any sport asks for, so
// the sport can still be detected (or changed) after the clip is made.
export const clipFps = (durationSec: number) => geminiFps("tennis", durationSec);
