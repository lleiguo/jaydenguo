import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MediaError, prepareMedia, probeDuration, reviewRange } from "@/worker/video/media";

// Media prep on a synthetic test-pattern clip (plan M5.3). Needs ffmpeg on
// the PATH, as in the worker image and CI.
const SAMPLE = "tests/fixtures/video/test-pattern-6s.mp4";
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("reviewRange", () => {
  it("defaults to the whole video", () => {
    expect(reviewRange(30, { start: null, end: null })).toEqual({ start: 0, end: 30 });
  });
  it("clamps the end to the video", () => {
    expect(reviewRange(30, { start: 10, end: 99 })).toEqual({ start: 10, end: 30 });
  });
  // Intent 0014, WVR-1: the whole video, up to ten minutes.
  it("reviews a whole video up to ten minutes", () => {
    expect(reviewRange(252, { start: null, end: null })).toEqual({ start: 0, end: 252 });
    expect(reviewRange(600, { start: null, end: null })).toEqual({ start: 0, end: 600 });
  });
  it("asks for a part on a longer video", () => {
    expect(() => reviewRange(660, { start: null, end: null })).toThrow(
      "The video is 11 min long. Mark a part of 10 minutes or less to review.",
    );
    expect(() => reviewRange(900, { start: 30, end: 700 })).toThrow(
      "The part you marked is 11.2 min long. Mark a part of 10 minutes or less.",
    );
  });
  it("refuses a segment past the end", () => {
    expect(() => reviewRange(30, { start: 40, end: null })).toThrow(MediaError);
  });
});

describe.runIf(hasFfmpeg)("prepareMedia", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "video-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the length", async () => {
    expect(await probeDuration(SAMPLE)).toBeCloseTo(6, 0);
  });

  // The clip's clock starts at zero, like Gemini's times and the playback
  // copy (intent 0003, PLAY-6).
  it("trims to the segment", async () => {
    const media = await prepareMedia(SAMPLE, dir, { start: 2, end: 5 });
    expect(media.durationSec).toBeCloseTo(3, 0);
    expect(media.offsetSec).toBe(2);
    expect(media.clip.length).toBeGreaterThan(1000);
    expect(media.playback!.length).toBeGreaterThan(1000);
  });

  // WVR-2, WVR-3: a 4-minute video goes to Gemini at 3 frames a second; the
  // playback copy keeps the source's rate and the same length.
  it("makes a low-rate clip for Gemini and a smooth playback copy", { timeout: 30_000 }, async () => {
    const long = join(dir, "long.mp4");
    execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi"],
      ...[
        "-i",
        "testsrc2=size=160x120:rate=30",
        "-t",
        "240",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        long,
      ],
    ]);
    const media = await prepareMedia(long, dir, { start: null, end: null });
    const fps = (file: Buffer) => {
      const path = join(dir, `probe-${file.length}.mp4`);
      writeFileSync(path, file);
      const out = execFileSync("ffprobe", [
        ...["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate"],
        ...["-of", "csv=p=0", path],
      ]).toString();
      const [n, d] = out.trim().split("/").map(Number);
      return n / d;
    };
    expect(media.durationSec).toBeCloseTo(240, 0);
    expect(fps(media.clip)).toBeCloseTo(3, 1);
    expect(fps(media.playback!)).toBeCloseTo(30, 0);
  });

  it("skips the playback copy when asked", async () => {
    const media = await prepareMedia(SAMPLE, dir, { start: null, end: null }, { playback: false });
    expect(media.playback).toBeNull();
  });

  it("refuses a file that isn't a video", async () => {
    await expect(prepareMedia("package.json", dir, { start: null, end: null })).rejects.toThrow(MediaError);
  });
});
