import { execFileSync } from "node:child_process";
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
  it("asks for a segment on a long video", () => {
    expect(() => reviewRange(600, { start: null, end: null })).toThrow(/Mark a segment of 120 s or less/);
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

  // Frame times count from the clip's start, like Gemini's times and the
  // playback copy (intent 0003, PLAY-6).
  it("trims to the segment and labels frames with the clip's times", async () => {
    const media = await prepareMedia(SAMPLE, dir, { start: 2, end: 5 }, true);
    expect(media.durationSec).toBeCloseTo(3, 0);
    expect(media.offsetSec).toBe(2);
    expect(media.clip.length).toBeGreaterThan(1000);
    expect(media.frames.length).toBeGreaterThan(5);
    expect(media.frames.length).toBeLessThanOrEqual(60);
    for (const f of media.frames) {
      expect(f.atSec).toBeGreaterThanOrEqual(0);
      expect(f.atSec).toBeLessThan(3.1);
      // JPEG magic number.
      expect(f.jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
    }
  });

  it("skips frames when only Gemini reviews", async () => {
    const media = await prepareMedia(SAMPLE, dir, { start: null, end: null }, false);
    expect(media.frames).toEqual([]);
  });

  it("refuses a file that isn't a video", async () => {
    await expect(prepareMedia("package.json", dir, { start: null, end: null }, true)).rejects.toThrow(
      MediaError,
    );
  });
});
