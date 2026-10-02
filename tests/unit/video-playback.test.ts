import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRange } from "@/domain/byte-range";
import { activePoint, citedSeconds, timelinePoints } from "@/domain/review-timeline";
import { localMediaStore, playbackKey } from "@/server/video/media-store";

// Playback copies next to their reviews (intent 0003, PLAY-2..5, PLAY-8).

describe("parseRange", () => {
  it("serves one range, clamped to the file", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("serves the whole file for no range, several ranges or nonsense", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
    expect(parseRange("bytes=9-3", 1000)).toBeNull();
  });

  it("refuses a range past the end", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });
});

describe("citedSeconds", () => {
  it("reads the start of a cited time", () => {
    expect(citedSeconds("0:04")).toBe(4);
    expect(citedSeconds("1:02")).toBe(62);
    expect(citedSeconds("00:07")).toBe(7);
    expect(citedSeconds("0:04-0:06")).toBe(4);
    expect(citedSeconds("around 0:03.5")).toBe(3.5);
  });

  it("is null without a time", () => {
    expect(citedSeconds(null)).toBeNull();
    expect(citedSeconds("throughout")).toBeNull();
    expect(citedSeconds("0:75")).toBeNull();
  });
});

describe("timelinePoints and activePoint", () => {
  const review = {
    good: [{ text: "Eyes on the ball", at: "0:03" }],
    fix: [
      { text: "Turn sooner", at: "0:02" },
      { text: "Finish high", at: null },
      { text: "Bend the knees", at: "0:04" },
    ],
  };
  const points = timelinePoints(review);

  it("keeps points with a time, in time order, keyed by section and place", () => {
    expect(points.map((p) => [p.key, p.sec])).toEqual([
      ["fix-0", 2],
      ["good-0", 3],
      ["fix-2", 4],
    ]);
  });

  it("shows a point for two seconds, the latest one when they overlap", () => {
    expect(activePoint(points, 1.9)).toBeNull();
    expect(activePoint(points, 2.5)?.key).toBe("fix-0");
    expect(activePoint(points, 3.2)?.key).toBe("good-0");
    expect(activePoint(points, 5.9)?.key).toBe("fix-2");
    expect(activePoint(points, 6)).toBeNull();
  });
});

describe("localMediaStore", () => {
  it("saves, reads a range, and deletes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "media-store-"));
    try {
      const store = localMediaStore(dir);
      const key = playbackKey("0b6f3c1e-8d2a-4c55-9a51-1f2e3d4c5b6a");
      await store.put(key, Buffer.from("0123456789"), "video/mp4");
      expect(await store.size(key)).toBe(10);
      const part = await new Response(await store.read(key, { start: 2, end: 5 })).text();
      expect(part).toBe("2345");
      await store.delete(key);
      expect(await store.size(key)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses keys it didn't make", async () => {
    const store = localMediaStore(tmpdir());
    await expect(store.size("../etc/passwd")).rejects.toThrow("bad media key");
  });
});
