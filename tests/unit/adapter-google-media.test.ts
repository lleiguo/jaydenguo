import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadPickedVideo, getPickerSession, VideoFetchError } from "@/adapters/google-media";

// Calls to Google for a review: a dropped connection on a short call is
// tried again, and a slow video download gets longer than a minute and says
// it timed out.
const video = {
  id: "m",
  baseUrl: "https://photos.test/v",
  mimeType: "video/mp4",
  filename: "v.mp4",
  processing: false,
};
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "google-media-"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("google media calls", () => {
  it("tries a short call again after a dropped connection", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        Response.json({ id: "s", pickerUri: "https://photos.test/p", mediaItemsSet: true }),
      );
    vi.stubGlobal("fetch", fetch);
    const session = await getPickerSession("t", "s");
    expect(session.mediaItemsSet).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second dropped connection, keeping the cause", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const err = await getPickerSession("t", "s").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VideoFetchError);
    expect((err as Error).message).toBe("Couldn't reach Google. Try again later.");
    expect((err as Error).cause).toBeInstanceOf(TypeError);
  });

  it("downloads with the longer timeout, once", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("bytes"));
    vi.stubGlobal("fetch", fetch);
    await downloadPickedVideo("t", video, join(dir, "v.mp4"));
    expect(readFileSync(join(dir, "v.mp4"), "utf8")).toBe("bytes");
    expect(String(fetch.mock.calls[0][0])).toBe("https://photos.test/v=dv");
  });

  it("says a download timed out", async () => {
    vi.stubEnv("VIDEO_DOWNLOAD_TIMEOUT_MS", "20");
    const fetch = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason)),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(downloadPickedVideo("t", video, join(dir, "v.mp4"))).rejects.toThrow(
      "Google took too long to answer. Try again in a few minutes.",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
