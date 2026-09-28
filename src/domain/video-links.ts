import type { VideoProvider } from "./video-constants";

// What kind of video link the owner pasted (VID-1, VID-2, F-3, F-4).
// Google Drive links are reviewed through the owner's Google account.
// YouTube and other links are kept with their note but can't be reviewed.
// Google Photos share links can't be read by apps at all since March 2025;
// the owner picks the video in Google Photos instead.

export type ParsedLink =
  { ok: true; provider: VideoProvider; url: string; driveFileId?: string } | { ok: false; error: string };

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "music.youtube.com",
]);
const PHOTOS_HOSTS = new Set(["photos.google.com", "photos.app.goo.gl", "goo.gl"]);

const DRIVE_ID = /^[\w-]{10,}$/;

export function parseVideoLink(input: string): ParsedLink {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, error: "That doesn't look like a link." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { ok: false, error: "That doesn't look like a web link." };
  const host = url.hostname.toLowerCase();
  if (DRIVE_HOSTS.has(host)) {
    const fromPath = /\/file\/d\/([^/]+)/.exec(url.pathname)?.[1];
    const id = fromPath ?? url.searchParams.get("id");
    if (!id || !DRIVE_ID.test(id))
      return {
        ok: false,
        error: "That Google Drive link doesn't point to a file. Use the file's Share link.",
      };
    return { ok: true, provider: "drive", url: url.href, driveFileId: id };
  }
  if (YOUTUBE_HOSTS.has(host)) return { ok: true, provider: "youtube", url: url.href };
  if (PHOTOS_HOSTS.has(host) && (host !== "goo.gl" || url.pathname.startsWith("/photos")))
    return {
      ok: false,
      error: 'Google Photos links can\'t be opened by the site. Use "Pick from Google Photos" instead.',
    };
  return { ok: true, provider: "other", url: url.href };
}

export const isReviewable = (p: VideoProvider) => p === "drive" || p === "photos";

// "m:ss" or seconds, for the segment fields. Null for an empty field.
export function parseClockTime(value: string | null | undefined): number | null {
  const v = value?.trim();
  if (!v) return null;
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(v);
  if (!m) return NaN;
  const minutes = m[1] ? Number(m[1]) : 0;
  const seconds = Number(m[2]);
  if (m[1] && seconds >= 60) return NaN;
  return minutes * 60 + seconds;
}

export function formatClockTime(sec: number): string {
  const whole = Math.round(sec);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
