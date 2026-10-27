import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { googleApiBase } from "../google-calendar";
import { USER_AGENT } from "../http";

// Fetching a video through the owner's Google account for one review
// (spec VID-2, F-4, plan M5.2): a Drive file by its ID, or a video the
// owner picks in Google Photos (the Picker API: the app opens a session,
// the owner picks in Google Photos, the app reads what was picked). The
// file goes to the job's temp folder and is deleted with it.

export const photosPickerBase = () => process.env.PHOTOS_PICKER_BASE ?? "https://photospicker.googleapis.com";

// Cloud Run's temp folder is memory; the worker has 2 GiB.
export const MAX_VIDEO_BYTES = 400 * 1024 * 1024;

export class VideoFetchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VideoFetchError";
  }
}

// A short call (a picker session, the pick) gets a minute and is tried once
// more on a dropped connection. Downloading the video gets longer: Google
// can take over a minute to start sending a video it has just finished
// processing, and the timeout covers the whole transfer.
const CALL_TIMEOUT_MS = 60_000;
export const DOWNLOAD_TIMEOUT_MS = () => Number(process.env.VIDEO_DOWNLOAD_TIMEOUT_MS ?? 10 * 60_000);

async function google(
  url: URL,
  token: string,
  init: RequestInit = {},
  { timeoutMs = CALL_TIMEOUT_MS, tries = (init.method ?? "GET") === "GET" ? 2 : 1 } = {},
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        headers: { authorization: `Bearer ${token}`, "user-agent": USER_AGENT, ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < tries) continue;
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new VideoFetchError(
        timedOut
          ? "Google took too long to answer. Try again in a few minutes."
          : "Couldn't reach Google. Try again later.",
        { cause: err },
      );
    }
  }
}

const downloading = () => ({ timeoutMs: DOWNLOAD_TIMEOUT_MS(), tries: 1 });

async function download(res: Response, dest: string) {
  if (!res.body) throw new VideoFetchError("Google sent an empty file.");
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_VIDEO_BYTES) throw tooLarge();
  let seen = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      if (seen > MAX_VIDEO_BYTES) done(tooLarge());
      else done(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      limit,
      createWriteStream(dest),
    );
  } catch (err) {
    if (err instanceof VideoFetchError) throw err;
    throw new VideoFetchError("The download from Google stopped part way. Try again.", { cause: err });
  }
  return seen;
}

const tooLarge = () =>
  new VideoFetchError(
    `The video is over ${MAX_VIDEO_BYTES / 1024 / 1024} MB. Trim it on the phone first, or upload just the part to review.`,
  );

// --- Drive ------------------------------------------------------------------

export type DriveFile = { name: string; mimeType: string };

export async function downloadDriveFile(token: string, fileId: string, dest: string): Promise<DriveFile> {
  const base = googleApiBase();
  const meta = await google(
    new URL(
      `/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType,size&supportsAllDrives=true`,
      base,
    ),
    token,
  );
  if (meta.status === 404)
    throw new VideoFetchError(
      "Can't open this link. Is the file in the connected Google account's Drive, or shared with it?",
    );
  if (meta.status === 401 || meta.status === 403)
    throw new VideoFetchError(
      "Can't open this link. Is the Google account still connected with Drive access?",
    );
  if (!meta.ok) throw new VideoFetchError(`Google Drive answered with an error (${meta.status}).`);
  const info = (await meta.json()) as { name?: string; mimeType?: string; size?: string };
  if (!info.mimeType?.startsWith("video/")) throw new VideoFetchError("That Drive file isn't a video.");
  if (Number(info.size ?? 0) > MAX_VIDEO_BYTES) throw tooLarge();
  const res = await google(
    new URL(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, base),
    token,
    {},
    downloading(),
  );
  if (!res.ok) throw new VideoFetchError(`Couldn't download the video from Google Drive (${res.status}).`);
  await download(res, dest);
  return { name: info.name ?? "video", mimeType: info.mimeType };
}

// --- Google Photos Picker -----------------------------------------------------

export type PickerSession = {
  id: string;
  pickerUri: string;
  mediaItemsSet: boolean;
  pollIntervalMs: number;
  expireTime: string | null;
};

const duration = (d: string | undefined, fallback: number) => {
  const s = Number(/^([\d.]+)s$/.exec(d ?? "")?.[1]);
  return s > 0 ? s * 1000 : fallback;
};

function session(body: Record<string, unknown>): PickerSession {
  const polling = body.pollingConfig as { pollInterval?: string } | undefined;
  return {
    id: String(body.id),
    pickerUri: String(body.pickerUri),
    mediaItemsSet: body.mediaItemsSet === true,
    pollIntervalMs: Math.min(duration(polling?.pollInterval, 5000), 30_000),
    expireTime: typeof body.expireTime === "string" ? body.expireTime : null,
  };
}

async function pickerJson(res: Response, what: string) {
  if (res.status === 401 || res.status === 403)
    throw new VideoFetchError(
      "Google Photos refused. Is the Google account still connected with Photos access?",
    );
  if (!res.ok)
    throw new VideoFetchError(`Google Photos answered with an error while ${what} (${res.status}).`);
  return (await res.json()) as Record<string, unknown>;
}

export async function createPickerSession(token: string): Promise<PickerSession> {
  const res = await google(new URL("/v1/sessions", photosPickerBase()), token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pickingConfig: { maxItemCount: "1" } }),
  });
  return session(await pickerJson(res, "opening the picker"));
}

export async function getPickerSession(token: string, id: string): Promise<PickerSession> {
  const res = await google(new URL(`/v1/sessions/${encodeURIComponent(id)}`, photosPickerBase()), token);
  return session(await pickerJson(res, "checking the pick"));
}

export async function deletePickerSession(token: string, id: string) {
  await google(new URL(`/v1/sessions/${encodeURIComponent(id)}`, photosPickerBase()), token, {
    method: "DELETE",
  }).catch(() => undefined);
}

// "processing": Google Photos is still encoding a video it has just
// received (an iPhone video picked soon after it was backed up); its
// bytes aren't downloadable yet.
export type PickedVideo = {
  id: string;
  baseUrl: string;
  mimeType: string;
  filename: string;
  processing: boolean;
};

export async function pickedVideo(token: string, sessionId: string): Promise<PickedVideo> {
  const url = new URL("/v1/mediaItems", photosPickerBase());
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("pageSize", "25");
  const body = await pickerJson(await google(url, token), "reading the pick");
  const items = (body.mediaItems ?? []) as {
    id: string;
    type?: string;
    mediaFile?: {
      baseUrl: string;
      mimeType?: string;
      filename?: string;
      mediaFileMetadata?: { videoMetadata?: { processingStatus?: string } };
    };
  }[];
  const video = items.find((i) => i.type === "VIDEO" && i.mediaFile?.baseUrl);
  if (!video) throw new VideoFetchError("No video was picked. Pick a video, not a photo.");
  const status = video.mediaFile!.mediaFileMetadata?.videoMetadata?.processingStatus;
  if (status === "FAILED")
    throw new VideoFetchError("Google Photos couldn't process this video. Pick another copy of it.");
  return {
    id: video.id,
    baseUrl: video.mediaFile!.baseUrl,
    mimeType: video.mediaFile!.mimeType ?? "video/mp4",
    filename: video.mediaFile!.filename ?? "video",
    processing: status === "PROCESSING",
  };
}

// "=dv" asks for the video bytes (not a still). The base URL needs the
// same access token. A 404 is what Google answers while it is still
// processing the video, so it is told apart for the caller to wait.
export class VideoNotReadyError extends VideoFetchError {
  constructor() {
    super("Google Photos is still processing this video. Try again in a few minutes.");
    this.name = "VideoNotReadyError";
  }
}

export async function downloadPickedVideo(token: string, video: PickedVideo, dest: string) {
  const res = await google(new URL(`${video.baseUrl}=dv`), token, {}, downloading());
  if (res.status === 404) throw new VideoNotReadyError();
  if (!res.ok) throw new VideoFetchError(`Couldn't download the video from Google Photos (${res.status}).`);
  await download(res, dest);
}
