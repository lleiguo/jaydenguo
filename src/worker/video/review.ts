import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, desc, eq, sql } from "drizzle-orm";
import { credentials, videoReviewRounds, videoReviews } from "@db/schema";
import {
  createPickerSession,
  deletePickerSession,
  downloadDriveFile,
  downloadPickedVideo,
  getPickerSession,
  pickedVideo,
  VideoFetchError,
  VideoNotReadyError,
} from "../../adapters/google-media";
import { googleAccessToken } from "../../adapters/google-calendar";
import { SyncError } from "../../adapters/types";
import { geminiFps } from "../../domain/video-fps";
import { parseVideoLink } from "../../domain/video-links";
import type { SportSource, VideoSport } from "../../domain/video-constants";
import type { Db } from "../../server/db/client";
import { geminiModel } from "../../server/llm/gemini";
import { LlmError, type StructuredModel } from "../../server/llm/types";
import { registerSecret } from "../../server/log";
import { detectSport } from "../../server/video/detect";
import { notifyVideo } from "../../server/push/kinds";
import { fakeModel } from "../../server/video/fake";
import { mediaStore, playbackKey, type MediaStore } from "../../server/video/media-store";
import { PROMPT_VERSION } from "../../server/video/prompts";
import { runReview } from "../../server/video/reviewer";
import { DRIVE_SCOPE, PHOTOS_SCOPE } from "../../server/video/store";
import type { JobContext } from "../context";
import { openCredential } from "../credentials";
import { MediaError, prepareMedia } from "./media";

// The review job (plan M5.2-M5.5, spec VID-2, VID-5): `video:review <id>`.
// Fetches the video through the owner's Google account into a temp folder,
// prepares it, works out the sport if asked (intent 0005), has Gemini review
// it, stores every model call as it finishes, keeps the clip as a playback
// copy if the review worked (intent 0003), and always deletes the temp
// folder, whether it worked or not. A review run again for another
// sport starts from its playback copy when there is one (SPT-6).

// How long the owner has to pick in Google Photos.
const PICK_TIMEOUT_MS = () => Number(process.env.PHOTOS_PICK_TIMEOUT_MS ?? 15 * 60_000);
// How long to wait for Google Photos to finish processing a picked video.
const PROCESSING_TIMEOUT_MS = () => Number(process.env.PHOTOS_PROCESSING_TIMEOUT_MS ?? 10 * 60_000);
const PROCESSING_POLL_MS = 15_000;

export type ReviewDeps = {
  model?: () => StructuredModel;
  accessToken?: (db: Db, scope: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  media?: () => MediaStore | null;
};

// Gemini on Vertex AI in production; a stand-in when VIDEO_LLM=fake (never
// on Cloud Run).
export function defaultModel(): StructuredModel {
  if (process.env.VIDEO_LLM === "fake") {
    if (process.env.K_SERVICE || process.env.CLOUD_RUN_JOB)
      throw new Error("VIDEO_LLM=fake is for local use only");
    return fakeModel();
  }
  return geminiModel();
}

async function defaultAccessToken(db: Db, scope: string): Promise<string> {
  const [cred] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(
      and(
        eq(credentials.provider, "google"),
        eq(credentials.status, "active"),
        sql`${scope} = any(${credentials.scopes})`,
      ),
    )
    .orderBy(desc(credentials.updatedAt))
    .limit(1);
  if (!cred)
    throw new VideoFetchError(
      "Connect Google Drive and Photos on the Videos page first (the Google account isn't connected).",
    );
  const opened = await openCredential(db, cred.id, "video review");
  try {
    const token = await googleAccessToken(opened.secret);
    registerSecret(token);
    return token;
  } catch (err) {
    if (err instanceof SyncError)
      throw new VideoFetchError(
        "Can't open the video. Is the Google account still connected? Reconnect it on the Accounts page.",
      );
    throw err;
  }
}

// A plain-language reason for the page (VID-5).
export function failureMessage(err: unknown): string {
  if (err instanceof VideoFetchError || err instanceof MediaError || err instanceof LlmError)
    return err.message;
  return "The review failed unexpectedly. Try again.";
}

export async function videoReviewJob(args: string[], ctx: JobContext, deps: ReviewDeps = {}) {
  const id = args[0];
  if (!id) throw new Error("usage: video:review <id>");
  const db = await ctx.db();
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const token = deps.accessToken ?? defaultAccessToken;
  const model = deps.model ?? defaultModel;
  const store = (deps.media ?? mediaStore)();

  const [row] = await db.select().from(videoReviews).where(eq(videoReviews.id, id));
  if (!row || row.deletedAt) return ctx.log("video review not found", { id }, "WARNING");
  if (row.status !== "queued" && row.status !== "picking")
    return ctx.log("video review not waiting", { id, status: row.status });

  const set = async (values: Partial<typeof videoReviews.$inferInsert>) => {
    await db.update(videoReviews).set(values).where(eq(videoReviews.id, id));
  };
  const progress = (text: string) => set({ progress: text });
  // Every call made for this review, earlier runs included (SPT-7).
  const totalCost = async () => {
    const [cost] = await db
      .select({ sum: sql<number>`coalesce(sum(${videoReviewRounds.costUsd}), 0)::float` })
      .from(videoReviewRounds)
      .where(eq(videoReviewRounds.reviewId, id));
    return Math.round((cost?.sum ?? 0) * 10_000) / 10_000;
  };
  // PUSH-1: done or failed, with the review's current sport.
  const notifyReview = async (status: "done" | "failed", error: string | null) => {
    const [r] = await db.select().from(videoReviews).where(eq(videoReviews.id, id));
    await notifyVideo(
      db,
      {
        id,
        status,
        sport: r.sport as VideoSport,
        sportSource: r.sportSource as SportSource,
        filmedOn: r.filmedOn,
        finishedAt: r.finishedAt ?? new Date(),
        error,
      },
      { log: ctx.log },
    );
  };
  // The playback copy is already the reviewed part: no segment, not saved again.
  const copy = row.playbackKey && store ? row.playbackKey : null;

  const dir = await mkdtemp(join(tmpdir(), "video-review-"));
  const src = join(dir, "source");
  try {
    // 1. The video, into the temp folder.
    if (copy && store) {
      await set({ status: "analysing", startedAt: new Date(), progress: "Opening the saved video" });
      const stream = await store.read(copy, null);
      await pipeline(
        Readable.fromWeb(stream as import("node:stream/web").ReadableStream),
        createWriteStream(src),
      );
    } else if (row.provider === "drive") {
      await set({
        status: "analysing",
        startedAt: new Date(),
        progress: "Fetching the video from Google Drive",
      });
      const link = parseVideoLink(row.url ?? "");
      if (!link.ok || !link.driveFileId)
        throw new VideoFetchError("That Google Drive link doesn't point to a file.");
      const file = await downloadDriveFile(await token(db, DRIVE_SCOPE), link.driveFileId, src);
      await set({ mediaName: file.name });
    } else if (row.provider === "photos") {
      const access = await token(db, PHOTOS_SCOPE);
      // A retried review reuses its pick; a picker session expires after a
      // while, and then the owner picks again (intent 0014, WVR-6).
      let session = row.pickerSessionId
        ? await getPickerSession(access, row.pickerSessionId).catch(() => null)
        : null;
      if (!session) {
        session = await createPickerSession(access);
        await set({
          status: "picking",
          pickerSessionId: session.id,
          pickerUri: `${session.pickerUri}/autoclose`,
          progress: "Waiting for you to pick the video in Google Photos",
        });
      }
      const deadline = Date.now() + PICK_TIMEOUT_MS();
      while (!session.mediaItemsSet) {
        if (Date.now() > deadline) {
          await deletePickerSession(access, session.id);
          throw new VideoFetchError(
            "Nothing was picked in Google Photos in time. Try again when you're ready to pick.",
          );
        }
        await sleep(session.pollIntervalMs);
        session = await getPickerSession(access, session.id);
      }
      let video = await pickedVideo(access, session.id);
      await set({
        status: "analysing",
        startedAt: new Date(),
        mediaItemId: video.id,
        mediaName: video.filename,
        pickerUri: null,
        progress: "Fetching the video from Google Photos",
      });
      // A video backed up moments ago is still being processed by Google
      // Photos: wait for it, reading the pick again for a fresh base URL.
      const ready = Date.now() + PROCESSING_TIMEOUT_MS();
      for (;;) {
        try {
          if (video.processing) throw new VideoNotReadyError();
          await downloadPickedVideo(access, video, src);
          break;
        } catch (e) {
          if (!(e instanceof VideoNotReadyError) || Date.now() > ready) throw e;
          await progress("Waiting for Google Photos to finish processing the video");
          await sleep(PROCESSING_POLL_MS);
          video = await pickedVideo(access, session.id);
          if (!video.processing) await progress("Fetching the video from Google Photos");
        }
      }
      await deletePickerSession(access, session.id);
    } else {
      throw new VideoFetchError("This kind of link can't be reviewed.");
    }

    // 2. Media prep.
    await progress("Preparing the video");
    const media = await prepareMedia(
      src,
      dir,
      copy ? { start: null, end: null } : { start: row.segmentStart, end: row.segmentEnd },
      { playback: !copy && !!store },
    );
    await set({ durationSec: media.durationSec, promptVersion: PROMPT_VERSION });
    const reviewer = model();
    const video = { kind: "video" as const, data: media.clip, mimeType: "video/mp4" };

    // 3. The sport, read again: the owner may have set it while picking.
    const [current] = await db
      .select({ sport: videoReviews.sport, source: videoReviews.sportSource })
      .from(videoReviews)
      .where(eq(videoReviews.id, id));
    let sport = current.sport as VideoSport;
    if (current.source === "detecting") {
      await progress("Working out the sport");
      const found = await detectSport(reviewer, { ...video, fps: 1 }, (message, fields) =>
        ctx.log(message, { id, ...fields }, "WARNING"),
      );
      if (found.round) await db.insert(videoReviewRounds).values({ reviewId: id, ...found.round });
      sport = found.sport;
      await set({ sport, sportSource: found.source });
    }

    // 4. The review.
    const result = await runReview(
      reviewer,
      {
        context: { sport, note: row.note },
        media: { ...video, fps: geminiFps(sport, media.durationSec) },
      },
      {
        progress,
        saveRound: async (r) => {
          await db.insert(videoReviewRounds).values({ reviewId: id, ...r });
        },
      },
    );
    // 5. The playback copy (PLAY-1). The review stands without it.
    const playback =
      copy ?? (store && media.playback ? await savePlayback(store, id, media.playback, ctx) : null);
    await set({
      status: "done",
      progress: null,
      combinedReview: result.review,
      costUsd: await totalCost(),
      finishedAt: new Date(),
      playbackKey: playback,
      playbackBytes: copy ? row.playbackBytes : playback ? media.playback!.length : null,
    });
    ctx.log("video review done", { id, costUsd: result.costUsd, playback: !!playback });
    await notifyReview("done", null);
  } catch (err) {
    const message = failureMessage(err);
    await set({
      status: "failed",
      progress: null,
      errorMessage: message,
      finishedAt: new Date(),
      costUsd: await totalCost(),
    });
    ctx.log("video review failed", { id, error: err }, "WARNING");
    await notifyReview("failed", message);
  } finally {
    // Nothing else is kept after the review (VID-2, intent 0003).
    await rm(dir, { recursive: true, force: true });
  }
}

async function savePlayback(store: MediaStore, id: string, clip: Buffer, ctx: JobContext) {
  const key = playbackKey(id);
  try {
    await store.put(key, clip, "video/mp4");
    return key;
  } catch (err) {
    ctx.log("playback copy not saved", { id, error: err }, "WARNING");
    return null;
  }
}
