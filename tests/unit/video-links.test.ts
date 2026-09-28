import { describe, expect, it } from "vitest";
import { formatClockTime, parseClockTime, parseVideoLink } from "@/domain/video-links";

describe("parseVideoLink", () => {
  it("reads a Drive file ID from a share link", () => {
    expect(parseVideoLink("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing")).toEqual({
      ok: true,
      provider: "drive",
      url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing",
      driveFileId: "1AbCdEfGhIjKlMnOp",
    });
  });

  it("reads a Drive file ID from an open?id= link", () => {
    expect(parseVideoLink("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toMatchObject({
      provider: "drive",
      driveFileId: "1AbCdEfGhIjKlMnOp",
    });
  });

  it("refuses a Drive folder link", () => {
    expect(parseVideoLink("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp")).toMatchObject({
      ok: false,
    });
  });

  it("keeps YouTube links as not reviewable (F-3)", () => {
    expect(parseVideoLink("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ ok: true, provider: "youtube" });
    expect(parseVideoLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({
      provider: "youtube",
    });
  });

  it("sends Google Photos links to the picker (F-4)", () => {
    const r = parseVideoLink("https://photos.app.goo.gl/abcdef");
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/Pick from Google Photos/);
  });

  it("keeps other web links", () => {
    expect(parseVideoLink("https://example.com/clip.mp4")).toMatchObject({ ok: true, provider: "other" });
  });

  it("refuses things that aren't web links", () => {
    expect(parseVideoLink("not a link")).toMatchObject({ ok: false });
    expect(parseVideoLink("javascript:alert(1)")).toMatchObject({ ok: false });
  });
});

describe("parseClockTime", () => {
  it("reads m:ss and plain seconds", () => {
    expect(parseClockTime("1:05")).toBe(65);
    expect(parseClockTime("12.5")).toBe(12.5);
    expect(parseClockTime("")).toBeNull();
    expect(parseClockTime(null)).toBeNull();
  });
  it("rejects nonsense", () => {
    expect(parseClockTime("1:75")).toBeNaN();
    expect(parseClockTime("abc")).toBeNaN();
  });
  it("round-trips", () => {
    expect(formatClockTime(65)).toBe("1:05");
  });
});
