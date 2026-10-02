import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { GEMINI_INLINE_LIMIT } from "../../server/llm/gemini";

// Media prep for a review (spec §6.3, plan M5.3), with ffmpeg in the worker
// image: trim to the owner's segment and shrink to a clip Gemini takes
// inline. All files go into the job's temp folder, which the job deletes
// (VID-2).

const run = promisify(execFile);
const FFMPEG = () => process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = () => process.env.FFPROBE_PATH ?? "ffprobe";

// A review looks at two minutes at most; longer videos need a segment.
export const MAX_REVIEW_SECONDS = 120;

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaError";
  }
}

export async function probeDuration(file: string): Promise<number> {
  try {
    const { stdout } = await run(FFPROBE(), [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      file,
    ]);
    const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
    if (!info.streams?.some((s) => s.codec_type === "video"))
      throw new MediaError("That file isn't a video.");
    const duration = Number(info.format?.duration);
    if (!(duration > 0)) throw new MediaError("Couldn't read the video's length.");
    return duration;
  } catch (err) {
    if (err instanceof MediaError) throw err;
    throw new MediaError("Couldn't open the video. Is it a normal video file?");
  }
}

export type Segment = { start: number | null; end: number | null };

// The part of the video to review, checked against its length.
export function reviewRange(duration: number, segment: Segment): { start: number; end: number } {
  const start = Math.max(0, segment.start ?? 0);
  const end = Math.min(duration, segment.end ?? duration);
  if (start >= duration) throw new MediaError("The segment starts after the video ends.");
  if (end - start < 0.5) throw new MediaError("The segment is too short to review.");
  if (end - start > MAX_REVIEW_SECONDS)
    throw new MediaError(
      `The part to review is ${Math.round(end - start)} s long. Mark a segment of ${MAX_REVIEW_SECONDS} s or less.`,
    );
  return { start, end };
}

// Trims and re-encodes to H.264 without sound, at most 720p, then 480p if
// that's still too large to send inline.
export async function prepareClip(src: string, dir: string, range: { start: number; end: number }) {
  for (const [height, crf] of [
    [720, 28],
    [480, 33],
  ] as const) {
    const out = join(dir, `clip-${height}.mp4`);
    await ffmpeg([
      "-ss",
      range.start.toFixed(3),
      "-to",
      range.end.toFixed(3),
      "-i",
      src,
      "-an",
      "-vf",
      `scale=-2:'min(${height},ih)',fps='min(30,source_fps)'`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      String(crf),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      out,
    ]);
    if ((await stat(out)).size <= GEMINI_INLINE_LIMIT) return out;
  }
  throw new MediaError("The video is too large to review even when shrunk. Mark a shorter segment.");
}

export type PreparedMedia = {
  clip: Buffer;
  durationSec: number;
  // Where the clip starts in the original video, in seconds.
  offsetSec: number;
};

// The clip to review. Its clock starts at zero, like the times Gemini cites
// and the playback copy (intent 0003, PLAY-6).
export async function prepareMedia(src: string, dir: string, segment: Segment): Promise<PreparedMedia> {
  const duration = await probeDuration(src);
  const range = reviewRange(duration, segment);
  const clipFile = await prepareClip(src, dir, range);
  const clipDuration = await probeDuration(clipFile);
  return { clip: await readFile(clipFile), durationSec: clipDuration, offsetSec: range.start };
}

async function ffmpeg(args: string[]) {
  try {
    return await run(FFMPEG(), ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    throw new MediaError("Couldn't process the video (ffmpeg failed). Is it a normal video file?");
  }
}
