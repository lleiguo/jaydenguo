import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, asc, eq, isNull } from "drizzle-orm";
import { videoQuestions, videoReviewRounds, videoReviews } from "@db/schema";
import type { VideoSport } from "../../domain/video-constants";
import { geminiFps } from "../../domain/video-fps";
import type { Db } from "../../server/db/client";
import { LlmError, type StructuredModel } from "../../server/llm/types";
import { mediaStore, type MediaStore } from "../../server/video/media-store";
import {
  answerSchema,
  PROMPT_VERSION,
  questionPrompt,
  reviewerSystem,
  type Answer,
  type Exchange,
  type Review,
} from "../../server/video/prompts";
import type { JobContext } from "../context";
import { MediaError, prepareMedia } from "./media";
import { defaultModel, failureMessage } from "./review";

// A follow-up question (intent 0026, ASK-2, ASK-3): `video:question <id>`.
// Gemini watches the review's playback copy again, with the review and the
// earlier answers, and answers the parent's question. The temp folder is
// always deleted. Neither the question nor the answer is logged (ASKSEC-2).

export type QuestionDeps = {
  model?: () => StructuredModel;
  media?: () => MediaStore | null;
};

export async function videoQuestionJob(args: string[], ctx: JobContext, deps: QuestionDeps = {}) {
  const id = args[0];
  if (!id) throw new Error("usage: video:question <question id>");
  const db = await ctx.db();
  const [row] = await db.select().from(videoQuestions).where(eq(videoQuestions.id, id));
  if (!row) return ctx.log("video question not found", { id });
  if (row.status !== "queued") return ctx.log("video question not waiting", { id, status: row.status });
  const set = (values: Partial<typeof videoQuestions.$inferInsert>) =>
    db.update(videoQuestions).set(values).where(eq(videoQuestions.id, id));
  await set({ status: "answering", startedAt: new Date() });

  const dir = await mkdtemp(join(tmpdir(), "video-question-"));
  let costUsd = 0;
  try {
    const [review] = await db
      .select()
      .from(videoReviews)
      .where(and(eq(videoReviews.id, row.reviewId), isNull(videoReviews.deletedAt)));
    const store = (deps.media ?? mediaStore)();
    if (!review || review.status !== "done" || !review.combinedReview)
      throw new MediaError("The review isn't there any more.");
    if (!review.playbackKey || !store)
      throw new MediaError("The video was deleted, so no more questions can be asked.");

    // 1. The playback copy, made into Gemini's clip as a review re-run does (SPT-6).
    const src = join(dir, "source");
    const stream = await store.read(review.playbackKey, null);
    await pipeline(
      Readable.fromWeb(stream as import("node:stream/web").ReadableStream),
      createWriteStream(src),
    );
    const media = await prepareMedia(src, dir, { start: null, end: null }, { playback: false });
    const sport = review.sport as VideoSport;

    // 2. The answer, with the earlier answers of this review in order.
    const model = (deps.model ?? defaultModel)();
    const earlier = await thread(db, row.reviewId, row.createdAt);
    const result = await withRetry(() =>
      model.call({
        purpose: "question",
        system: reviewerSystem(),
        prompt: questionPrompt(
          { sport, note: review.note },
          review.combinedReview as Review,
          earlier,
          row.question,
        ),
        schema: answerSchema,
        media: {
          kind: "video",
          data: media.clip,
          mimeType: "video/mp4",
          fps: geminiFps(sport, media.durationSec),
        },
      }),
    );
    costUsd = result.costUsd;
    await db.insert(videoReviewRounds).values({
      reviewId: row.reviewId,
      round: "question",
      model: model.name,
      modelVersion: result.modelVersion,
      promptVersion: PROMPT_VERSION,
      output: { questionId: id, ...result.output },
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    });
    await set({ status: "done", answer: result.output, costUsd, finishedAt: new Date() });
    ctx.log("video question answered", { id, reviewId: row.reviewId, costUsd });
  } catch (err) {
    await set({ status: "failed", errorMessage: failureMessage(err), costUsd, finishedAt: new Date() });
    ctx.log("video question failed", { id, reviewId: row.reviewId, error: err }, "WARNING");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// The answered questions asked before this one, oldest first.
async function thread(db: Db, reviewId: string, before: Date): Promise<Exchange[]> {
  const rows = await db
    .select({
      question: videoQuestions.question,
      answer: videoQuestions.answer,
      at: videoQuestions.createdAt,
    })
    .from(videoQuestions)
    .where(and(eq(videoQuestions.reviewId, reviewId), eq(videoQuestions.status, "done")))
    .orderBy(asc(videoQuestions.createdAt));
  return rows.filter((r) => r.at < before).map((r) => ({ question: r.question, answer: r.answer as Answer }));
}

// A malformed answer is asked for once more, as for the review.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LlmError && err.kind === "invalid_output") return fn();
    throw err;
  }
}
