import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { clipFps } from "../../domain/video-fps";
import { GEMINI_INLINE_LIMIT } from "../../server/llm/gemini";

// Media prep for a review (spec §6.3, plan M5.3), with ffmpeg in the worker
// image: trim to the owner's segment, shrink to a clip Gemini takes inline,
// and make the playback copy (intent 0014, WVR-2, WVR-3). All files go
// into the job's temp folder, which the job deletes (VID-2).

const run = promisify(execFile);
const FFMPEG = () => process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = () => process.env.FFPROBE_PATH ?? "ffprobe";

// A review looks at ten minutes at most; longer videos need a part marked
// (intent 0014, WVR-1).
export const MAX_REVIEW_SECONDS = 600;

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
  if (end - start > MAX_REVIEW_SECONDS) {
    const mins = Math.round(((end - start) / 60) * 10) / 10;
    throw new MediaError(
      segment.start === null && segment.end === null
        ? `The video is ${mins} min long. Mark a part of ${MAX_REVIEW_SECONDS / 60} minutes or less to review.`
        : `The part you marked is ${mins} min long. Mark a part of ${MAX_REVIEW_SECONDS / 60} minutes or less.`,
    );
  }
  return { start, end };
}

type Range = { start: number; end: number };

const encode = (src: string, out: string, range: Range, height: number, crf: number, fps: string) =>
  ffmpeg([
    "-ss",
    range.start.toFixed(3),
    "-to",
    range.end.toFixed(3),
    "-i",
    src,
    "-an",
    "-vf",
    `scale=-2:'min(${height},ih)',fps=${fps}`,
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

// The clip for Gemini: H.264 without sound at the frame rate Gemini reads,
// at most 720p, then 480p and 360p if that's still too large to send inline.
export async function prepareClip(src: string, dir: string, range: Range) {
  const fps = String(clipFps(range.end - range.start));
  for (const [height, crf] of [
    [720, 28],
    [480, 33],
    [360, 36],
  ] as const) {
    const out = join(dir, `clip-${height}.mp4`);
    await encode(src, out, range, height, crf, fps);
    if ((await stat(out)).size <= GEMINI_INLINE_LIMIT) return out;
  }
  throw new MediaError("The video is too large to review even when shrunk. Mark a shorter part.");
}

// The playback copy (0003 PLAY-1, WVR-3): the reviewed part at 720p and up
// to 30 frames a second, so the player is smooth whatever Gemini read.
async function preparePlayback(src: string, dir: string, range: Range) {
  const out = join(dir, "playback.mp4");
  await encode(src, out, range, 720, 28, "'min(30,source_fps)'");
  return out;
}

export type PreparedMedia = {
  clip: Buffer;
  // Null when not asked for (the review starts from its playback copy).
  playback: Buffer | null;
  durationSec: number;
  // Where the clip starts in the original video, in seconds.
  offsetSec: number;
};

// The clip to review. Its clock starts at zero, like the times Gemini cites
// and the playback copy (intent 0003, PLAY-6).
export async function prepareMedia(
  src: string,
  dir: string,
  segment: Segment,
  { playback = true }: { playback?: boolean } = {},
): Promise<PreparedMedia> {
  const duration = await probeDuration(src);
  const range = reviewRange(duration, segment);
  const clipFile = await prepareClip(src, dir, range);
  const clipDuration = await probeDuration(clipFile);
  const playbackFile = playback ? await preparePlayback(src, dir, range) : null;
  return {
    clip: await readFile(clipFile),
    playback: playbackFile ? await readFile(playbackFile) : null,
    durationSec: clipDuration,
    offsetSec: range.start,
  };
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
