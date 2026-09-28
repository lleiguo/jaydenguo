import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { credentials, settings, videoReviewRounds, videoReviews } from "@db/schema";
import {
  MODEL_LABEL,
  REVIEW_MODELS,
  REVIEW_MODES,
  VIDEO_SPORTS,
  type ReviewMode,
  type ReviewModel,
  type VideoSport,
} from "../../domain/video-constants";
import { isReviewable, parseVideoLink } from "../../domain/video-links";
import type { Db, DbOrTx } from "../db/client";
import { HttpError } from "../errors";
import type { JobLauncher } from "../jobs/launcher";
import type { Verdict } from "./debate";
import type { MediaStore } from "./media-store";

// Video reviews for the web app (plan M5.2, M5.6; spec VID-1..5). The web
// app saves the link and starts the worker job; the worker fetches the
// video and writes the review (src/worker/video/review.ts).

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const PHOTOS_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";

// --- Settings (VID-3e) ----------------------------------------------------

const MODE_KEY = "video_review_mode";

export async function getReviewMode(db: DbOrTx): Promise<ReviewMode> {
  const [row] = await db.select().from(settings).where(eq(settings.key, MODE_KEY));
  return (REVIEW_MODES as readonly unknown[]).includes(row?.value) ? (row!.value as ReviewMode) : "debate";
}

export async function setReviewMode(db: DbOrTx, mode: ReviewMode) {
  await db
    .insert(settings)
    .values({ key: MODE_KEY, value: mode })
    .onConflictDoUpdate({ target: settings.key, set: { value: mode, updatedAt: new Date() } });
}

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
    sport: z.enum(VIDEO_SPORTS),
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
  const mode = await getReviewMode(db);
  // VID-1: the link is saved before any analysis runs.
  const [row] = await db
    .insert(videoReviews)
    .values({
      sport: input.sport,
      url,
      provider,
      note: input.note || null,
      filmedOn: input.filmedOn,
      segmentStart: input.segmentStart,
      segmentEnd: input.segmentEnd,
      mode,
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
      mode: await getReviewMode(db),
    })
    .where(eq(videoReviews.id, id));
  await db.delete(videoReviewRounds).where(eq(videoReviewRounds.reviewId, id));
  await startReview(db, id, launcher);
}

// --- Read -----------------------------------------------------------------

export type VideoReviewSummary = {
  id: string;
  sport: VideoSport;
  url: string | null;
  provider: string;
  note: string | null;
  filmedOn: string;
  status: string;
  mode: ReviewMode;
  progress: string | null;
  errorMessage: string | null;
  pickerUri: string | null;
  mediaName: string | null;
  winner: ReviewModel | null;
  tie: boolean;
  parentVote: ReviewModel | null;
  createdAt: string;
  deletedAt: string | null;
};

type Row = typeof videoReviews.$inferSelect;

const summary = (r: Row): VideoReviewSummary => {
  const verdict = r.verdict as Verdict | null;
  return {
    id: r.id,
    sport: r.sport as VideoSport,
    url: r.url,
    provider: r.provider,
    note: r.note,
    filmedOn: r.filmedOn,
    status: r.status,
    mode: r.mode as ReviewMode,
    progress: r.progress,
    errorMessage: r.errorMessage,
    // Only while the owner still has to pick.
    pickerUri: r.status === "picking" ? r.pickerUri : null,
    mediaName: r.mediaName,
    winner: verdict?.winner ?? null,
    tie: verdict?.tie ?? false,
    parentVote: r.parentVote as ReviewModel | null,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
  };
};

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
  verdict: Verdict | null;
  combinedReview: unknown;
  costUsd: number | null;
  votedAt: string | null;
  finishedAt: string | null;
  // A playback copy is kept (intent 0003, PLAY-1).
  hasPlayback: boolean;
  rounds: {
    round: string;
    model: ReviewModel;
    modelVersion: string;
    labels: unknown;
    output: unknown;
    scores: unknown;
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
    .where(eq(videoReviewRounds.reviewId, id))
    .orderBy(asc(videoReviewRounds.createdAt));
  return {
    ...summary(row),
    segmentStart: row.segmentStart,
    segmentEnd: row.segmentEnd,
    durationSec: row.durationSec,
    promptVersion: row.promptVersion,
    verdict: row.verdict as Verdict | null,
    combinedReview: row.combinedReview,
    costUsd: row.costUsd,
    votedAt: row.votedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    hasPlayback: row.playbackKey !== null,
    rounds: rounds.map((r) => ({
      round: r.round,
      model: r.model as ReviewModel,
      modelVersion: r.modelVersion,
      labels: r.labels,
      output: r.output,
      scores: r.scores,
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

export const voteInput = z.object({ vote: z.enum(REVIEW_MODELS) });

// VID-3d: written once, never overwritten.
export async function voteVideoReview(db: Db, id: string, vote: ReviewModel) {
  const [row] = await db
    .update(videoReviews)
    .set({ parentVote: vote, votedAt: new Date() })
    .where(
      and(
        eq(videoReviews.id, id),
        isNull(videoReviews.parentVote),
        eq(videoReviews.status, "done"),
        eq(videoReviews.mode, "debate"),
      ),
    )
    .returning({ id: videoReviews.id });
  if (row) return;
  const [existing] = await db.select().from(videoReviews).where(eq(videoReviews.id, id));
  if (!existing) throw new HttpError(404, "not found");
  if (existing.parentVote)
    throw new HttpError(
      409,
      `Your vote (${MODEL_LABEL[existing.parentVote as ReviewModel]}) is already saved.`,
    );
  throw new HttpError(409, "Only a finished two-model review can be voted on.");
}

// --- Scoreboard (VID-3d) --------------------------------------------------

export type ScoreboardRow = {
  sport: VideoSport;
  debates: number;
  ties: number;
  judgeWins: Record<ReviewModel, number>;
  parentWins: Record<ReviewModel, number>;
  voted: number;
  // Of the votes on reviews that weren't a tie: how often the judges' winner
  // was the parent's choice.
  agreed: number;
  comparable: number;
  // Average points each model gave its own review above the other judge.
  selfPreference: Record<ReviewModel, number | null>;
  // What each model was given (F-13).
  input: Record<ReviewModel, string>;
};

export async function scoreboard(db: DbOrTx): Promise<ScoreboardRow[]> {
  const rows = await db
    .select({ sport: videoReviews.sport, verdict: videoReviews.verdict, vote: videoReviews.parentVote })
    .from(videoReviews)
    .where(
      and(
        isNull(videoReviews.deletedAt),
        eq(videoReviews.status, "done"),
        eq(videoReviews.mode, "debate"),
        sql`${videoReviews.verdict} is not null`,
      ),
    );
  const bySport = new Map<VideoSport, ScoreboardRow & { self: Record<ReviewModel, number[]> }>();
  for (const r of rows) {
    const sport = r.sport as VideoSport;
    const v = r.verdict as Verdict;
    let s = bySport.get(sport);
    if (!s) {
      s = {
        sport,
        debates: 0,
        ties: 0,
        judgeWins: { gemini: 0, claude: 0 },
        parentWins: { gemini: 0, claude: 0 },
        voted: 0,
        agreed: 0,
        comparable: 0,
        selfPreference: { gemini: null, claude: null },
        input: { gemini: "whole video", claude: "frames" },
        self: { gemini: [], claude: [] },
      };
      bySport.set(sport, s);
    }
    s.debates++;
    if (v.tie) s.ties++;
    else s.judgeWins[v.winner]++;
    for (const m of REVIEW_MODELS) s.self[m].push(v.selfScores[m].preference);
    const vote = r.vote as ReviewModel | null;
    if (vote) {
      s.voted++;
      s.parentWins[vote]++;
      if (!v.tie) {
        s.comparable++;
        if (vote === v.winner) s.agreed++;
      }
    }
  }
  const avg = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  return VIDEO_SPORTS.flatMap((sport) => {
    const s = bySport.get(sport);
    if (!s) return [];
    const { self, ...rest } = s;
    return [{ ...rest, selfPreference: { gemini: avg(self.gemini), claude: avg(self.claude) } }];
  });
}
