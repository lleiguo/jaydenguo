// Technique reviews of linked videos (plan M5.2-M5.6, spec VID-1..5, §6.3).
// The link, the owner's note and the model's output are kept, plus a small
// playback copy of the reviewed clip (intent 0003, PLAY-1); everything else
// the job fetches or makes goes into a temp folder and is deleted. Reviews
// are soft-deleted (VID-4).
//
// Reviews used to be a debate between Gemini and Claude; now Gemini reviews
// alone. The debate's columns (mode, verdict, parent_vote, voted_at, and a
// round's labels and scores) and the values its rows hold are still in the
// database. Nothing reads or writes them.
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  SPORT_SOURCES,
  VIDEO_PROVIDERS,
  VIDEO_SPORTS,
  VIDEO_STATUSES,
} from "../../src/domain/video-constants";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

// What the debate's rows hold.
const OLD_MODELS = ["gemini", "claude"];
const OLD_MODES = ["debate", ...OLD_MODELS];
const OLD_ROUNDS = ["detect", "review", "critique", "rebuttal", "final_score", "combine"];

export const videoReviews = pgTable(
  "video_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sport: text("sport").notNull(),
    // intent 0005, SPT-4: chosen, detecting, detected or unsure.
    sportSource: text("sport_source").notNull().default("chosen"),
    // The pasted link, or for Google Photos the picked item's product URL
    // once known (null while the owner is picking).
    url: text("url"),
    provider: text("provider").notNull(),
    note: text("note"),
    filmedOn: date("filmed_on").notNull(),
    // Optional segment to review, in seconds from the start (§6.3).
    segmentStart: real("segment_start"),
    segmentEnd: real("segment_end"),
    status: text("status").notNull().default("queued"),
    mode: text("mode").notNull().default("gemini"),
    // What the job is doing now, in words for the page (VID-5).
    progress: text("progress"),
    // Plain language, never secrets (CRED-5).
    errorMessage: text("error_message"),
    // Google Photos Picker (F-4): the session the worker opened and the link
    // the owner follows to pick the video. The item's ID once picked.
    pickerSessionId: text("picker_session_id"),
    pickerUri: text("picker_uri"),
    mediaItemId: text("media_item_id"),
    // File name or title shown in the history, when the source gives one.
    mediaName: text("media_name"),
    durationSec: real("duration_sec"),
    // The playback copy's object name in the media store, or null when there
    // is none (older reviews, or deleted by the owner: PLAY-7).
    playbackKey: text("playback_key"),
    playbackBytes: integer("playback_bytes"),
    promptVersion: text("prompt_version"),
    verdict: jsonb("verdict"),
    // The review (VID-3).
    combinedReview: jsonb("combined_review"),
    parentVote: text("parent_vote"),
    votedAt: ts("voted_at"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4, mode: "number" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("video_reviews_sport_created_idx").on(t.sport, t.createdAt),
    check("video_reviews_sport_chk", sql`${t.sport} in (${inList(VIDEO_SPORTS)})`),
    check("video_reviews_sport_source_chk", sql`${t.sportSource} in (${inList(SPORT_SOURCES)})`),
    check("video_reviews_provider_chk", sql`${t.provider} in (${inList(VIDEO_PROVIDERS)})`),
    check("video_reviews_status_chk", sql`${t.status} in (${inList(VIDEO_STATUSES)})`),
    check("video_reviews_mode_chk", sql`${t.mode} in (${inList(OLD_MODES)})`),
    check(
      "video_reviews_vote_chk",
      sql`${t.parentVote} is null or ${t.parentVote} in (${inList(OLD_MODELS)})`,
    ),
    check(
      "video_reviews_segment_chk",
      sql`${t.segmentStart} is null or ${t.segmentEnd} is null or ${t.segmentEnd} > ${t.segmentStart}`,
    ),
  ],
);

// Every model call of a review, kept for the page and the costs page (§6.3
// "Output and storage").
export const videoReviewRounds = pgTable(
  "video_review_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => videoReviews.id),
    round: text("round").notNull(),
    // Who wrote this output.
    model: text("model").notNull(),
    modelVersion: text("model_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    labels: jsonb("labels"),
    output: jsonb("output").notNull(),
    scores: jsonb("scores"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4, mode: "number" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    // An earlier run's round (retry, or review again for another sport:
    // intent 0005, SPT-6): kept for the costs page, not shown.
    supersededAt: ts("superseded_at"),
  },
  (t) => [
    index("video_review_rounds_review_idx").on(t.reviewId, t.createdAt),
    check("video_review_rounds_round_chk", sql`${t.round} in (${inList(OLD_ROUNDS)})`),
    check("video_review_rounds_model_chk", sql`${t.model} in (${inList(OLD_MODELS)})`),
  ],
);
