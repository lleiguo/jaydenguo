import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { credentials, videoReviewRounds, videoReviews } from "@db/schema";
import { AUTO_SPORT, VIDEO_SPORTS, type SportSource, type VideoSport } from "../../domain/video-constants";
import { isReviewable, parseVideoLink } from "../../domain/video-links";
import type { Db, DbOrTx } from "../db/client";
import { HttpError } from "../errors";
import type { JobLauncher } from "../jobs/launcher";
import type { MediaStore } from "./media-store";

// Video reviews for the web app (plan M5.2, M5.6; spec VID-1..5). The web
// app saves the link and starts the worker job; the worker fetches the
// video and writes the review (src/worker/video/review.ts).

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const PHOTOS_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";

// Whether a connected Google account has granted Drive and Photos (CRED-2).
export async function videoGoogleAccess(db: DbOrTx) {
  const rows = await db
    .select({ scopes: credentials.scopes })
    .from(credentials)
    .where(and(eq(credentials.provider, "google"), eq(credentials.status, "active")));
  const has = (scope: string) => rows.some((r) => r.scopes?.includes(scope));
  return { drive: has(DRIVE_SCOPE), photos: has(PHOTOS_SCOPE) };
}

// --- Create ---------------------------------------------------------------

const clock = z
  .number()
  .min(0)
  .max(6 * 3600)
  .nullable()
  .default(null);

export const createVideoInput = z
  .object({
    // A pasted link, or null to pick from Google Photos (F-4).
    url: z.string().trim().max(2000).nullable(),
    // "auto": the job works out the sport (intent 0005, SPT-1).
    sport: z.enum([...VIDEO_SPORTS, AUTO_SPORT]),
    filmedOn: z.iso.date("Enter the date it was filmed"),
    note: z.string().trim().max(500).nullable().default(null),
    segmentStart: clock,
    segmentEnd: clock,
  })
  .refine((v) => v.segmentStart === null || v.segmentEnd === null || v.segmentEnd > v.segmentStart, {
    message: "The segment must end after it starts",
    path: ["segmentEnd"],
  });

export async function createVideoReview(
  db: Db,
  input: z.infer<typeof createVideoInput>,
  launcher: JobLauncher,
): Promise<{ id: string; status: string }> {
  let provider: "drive" | "photos" | "youtube" | "other" = "photos";
  let url: string | null = null;
  if (input.url) {
    const link = parseVideoLink(input.url);
    if (!link.ok) throw new HttpError(400, link.error);
    provider = link.provider;
    url = link.url;
  }
  const reviewable = isReviewable(provider);
  if (reviewable) {
    const access = await videoGoogleAccess(db);
    if (provider === "drive" && !access.drive)
      throw new HttpError(409, "Connect Google Drive and Photos first (the button above the form).");
    if (provider === "photos" && !access.photos)
      throw new HttpError(409, "Connect Google Drive and Photos first (the button above the form).");
  }
  // SPT-1: a link the site can't watch can't be detected either.
  const auto = input.sport === AUTO_SPORT;
  // VID-1: the link is saved before any analysis runs.
  const [row] = await db
    .insert(videoReviews)
    .values({
      sport: auto ? "other" : input.sport,
      sportSource: !auto ? "chosen" : reviewable ? "detecting" : "unsure",
      url,
      provider,
      note: input.note || null,
      filmedOn: input.filmedOn,
      segmentStart: input.segmentStart,
      segmentEnd: input.segmentEnd,
      status: !reviewable ? "saved" : provider === "photos" ? "picking" : "queued",
      progress: provider === "photos" ? "Opening Google Photos" : reviewable ? "Waiting to start" : null,
    })
    .returning({ id: videoReviews.id, status: videoReviews.status });
  if (reviewable) await startReview(db, row.id, launcher);
  return row;
}

async function startReview(db: Db, id: string, launcher: JobLauncher) {
  try {
    await launcher.start(["video:review", id]);
  } catch {
    await db
      .update(videoReviews)
      .set({ status: "failed", errorMessage: "Couldn't start the review. Try again.", progress: null })
      .where(eq(videoReviews.id, id));
  }
}

// A failed review can be tried again; a Photos pick starts over if nothing
// was picked.
export async function retryVideoReview(db: Db, id: string, launcher: JobLauncher) {
  const [row] = await db.select().from(videoReviews).where(eq(videoReviews.id, id));
  if (!row || row.deletedAt) throw new HttpError(404, "not found");
  if (row.status !== "failed") throw new HttpError(409, "Only a failed review can be tried again.");
  const repick = row.provider === "photos" && !row.mediaItemId;
  await db
    .update(videoReviews)
    .set({
      status: repick ? "picking" : "queued",
      progress: repick ? "Opening Google Photos" : "Waiting to start",
      errorMessage: null,
      pickerSessionId: repick ? null : row.pickerSessionId,
      pickerUri: null,
    })
    .where(eq(videoReviews.id, id));
  await supersedeRounds(db, id);
  await startReview(db, id, launcher);
}

// An earlier run's rounds stay for the costs page (intent 0005, SPT-7).
async function supersedeRounds(db: DbOrTx, id: string) {
  await db
    .update(videoReviewRounds)
    .set({ supersededAt: new Date() })
    .where(and(eq(videoReviewRounds.reviewId, id), isNull(videoReviewRounds.supersededAt)));
}

export const changeSportInput = z.object({
  sport: z.enum(VIDEO_SPORTS),
  // A finished review: run it again for the new sport (SPT-6), or only
  // change the label.
  reviewAgain: z.boolean().default(false),
});

// intent 0005, SPT-5, SPT-6: the owner sets the sport.
export async function changeVideoSport(
  db: Db,
  id: string,
  input: z.infer<typeof changeSportInput>,
  launcher: JobLauncher,
): Promise<VideoReviewSummary> {
  const [row] = await db.select().from(videoReviews).where(eq(videoReviews.id, id));
  if (!row || row.deletedAt) throw new HttpError(404, "not found");
  if (row.status === "analysing")
    throw new HttpError(409, "The review is running. Change the sport when it has finished.");
  const again = input.reviewAgain && row.status === "done";
  if (!again) {
    const [updated] = await db
      .update(videoReviews)
      .set({ sport: input.sport, sportSource: "chosen" })
      .where(and(eq(videoReviews.id, id), sql`${videoReviews.status} <> 'analysing'`))
      .returning();
    if (!updated) throw new HttpError(409, "The review is running. Change the sport when it has finished.");
    if (input.reviewAgain && row.status === "failed") await retryVideoReview(db, id, launcher);
    return summary((await db.select().from(videoReviews).where(eq(videoReviews.id, id)))[0]);
  }
  // Run again from the playback copy; without one, fetch or pick again.
  const repick = row.provider === "photos" && !row.playbackKey;
  const [updated] = await db
    .update(videoReviews)
    .set({
      sport: input.sport,
      sportSource: "chosen",
      status: repick ? "picking" : "queued",
      progress: repick ? "Opening Google Photos" : "Waiting to start",
      errorMessage: null,
      combinedReview: null,
      startedAt: null,
      finishedAt: null,
      pickerSessionId: repick ? null : row.pickerSessionId,
      pickerUri: null,
    })
    .where(and(eq(videoReviews.id, id), eq(videoReviews.status, "done")))
    .returning();
  if (!updated) throw new HttpError(409, "The review changed meanwhile. Reload and try again.");
  await supersedeRounds(db, id);
  await startReview(db, id, launcher);
  return summary((await db.select().from(videoReviews).where(eq(videoReviews.id, id)))[0]);
}

// --- Read -----------------------------------------------------------------

export type VideoReviewSummary = {
  id: string;
  sport: VideoSport;
  sportSource: SportSource;
  url: string | null;
  provider: string;
  note: string | null;
  filmedOn: string;
  status: string;
  progress: string | null;
  errorMessage: string | null;
  pickerUri: string | null;
  mediaName: string | null;
  createdAt: string;
  deletedAt: string | null;
};

type Row = typeof videoReviews.$inferSelect;

const summary = (r: Row): VideoReviewSummary => ({
  id: r.id,
  sport: r.sport as VideoSport,
  sportSource: r.sportSource as SportSource,
  url: r.url,
  provider: r.provider,
  note: r.note,
  filmedOn: r.filmedOn,
  status: r.status,
  progress: r.progress,
  errorMessage: r.errorMessage,
  // Only while the owner still has to pick.
  pickerUri: r.status === "picking" ? r.pickerUri : null,
  mediaName: r.mediaName,
  createdAt: r.createdAt.toISOString(),
  deletedAt: r.deletedAt?.toISOString() ?? null,
});

// VID-4: newest first, per sport or all; deleted ones only when asked.
export async function listVideoReviews(db: DbOrTx, opts: { sport?: VideoSport; deleted?: boolean } = {}) {
  const rows = await db
    .select()
    .from(videoReviews)
    .where(
      and(
        opts.deleted ? isNotNull(videoReviews.deletedAt) : isNull(videoReviews.deletedAt),
        opts.sport ? eq(videoReviews.sport, opts.sport) : undefined,
      ),
    )
    .orderBy(desc(videoReviews.filmedOn), desc(videoReviews.createdAt));
  return rows.map(summary);
}

export type VideoReviewDetail = VideoReviewSummary & {
  segmentStart: number | null;
  segmentEnd: number | null;
  durationSec: number | null;
  promptVersion: string | null;
  combinedReview: unknown;
  costUsd: number | null;
  finishedAt: string | null;
  // A playback copy is kept (intent 0003, PLAY-1).
  hasPlayback: boolean;
  rounds: {
    round: string;
    model: string;
    modelVersion: string;
    output: unknown;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
  }[];
};

export async function getVideoReview(db: DbOrTx, id: string): Promise<VideoReviewDetail | null> {
  const [row] = await db.select().from(videoReviews).where(eq(videoReviews.id, id));
  if (!row) return null;
  const rounds = await db
    .select()
    .from(videoReviewRounds)
    .where(and(eq(videoReviewRounds.reviewId, id), isNull(videoReviewRounds.supersededAt)))
    .orderBy(asc(videoReviewRounds.createdAt));
  return {
    ...summary(row),
    segmentStart: row.segmentStart,
    segmentEnd: row.segmentEnd,
    durationSec: row.durationSec,
    promptVersion: row.promptVersion,
    combinedReview: row.combinedReview,
    costUsd: row.costUsd,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    hasPlayback: row.playbackKey !== null,
    rounds: rounds.map((r) => ({
      round: r.round,
      model: r.model,
      modelVersion: r.modelVersion,
      output: r.output,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
    })),
  };
}

// --- Change ---------------------------------------------------------------

export async function deleteVideoReview(db: Db, id: string) {
  const [row] = await db
    .update(videoReviews)
    .set({ deletedAt: new Date() })
    .where(and(eq(videoReviews.id, id), isNull(videoReviews.deletedAt)))
    .returning({ id: videoReviews.id });
  if (!row) throw new HttpError(404, "not found");
}

export async function restoreVideoReview(db: Db, id: string) {
  const [row] = await db
    .update(videoReviews)
    .set({ deletedAt: null })
    .where(and(eq(videoReviews.id, id), isNotNull(videoReviews.deletedAt)))
    .returning({ id: videoReviews.id });
  if (!row) throw new HttpError(404, "not found");
}

// PLAY-2: the playback copy's key, for a review that isn't deleted.
export async function playbackOf(db: DbOrTx, id: string): Promise<string | null> {
  const [row] = await db
    .select({ key: videoReviews.playbackKey })
    .from(videoReviews)
    .where(and(eq(videoReviews.id, id), isNull(videoReviews.deletedAt)));
  return row?.key ?? null;
}

// PLAY-7: the copy goes for good; the review stays.
export async function deletePlayback(db: Db, store: MediaStore, id: string) {
  const key = await playbackOf(db, id);
  if (!key) throw new HttpError(404, "not found");
  await store.delete(key);
  await db
    .update(videoReviews)
    .set({ playbackKey: null, playbackBytes: null })
    .where(eq(videoReviews.id, id));
}
