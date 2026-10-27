import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { videoQuestions, videoReviewRounds, videoReviews } from "@db/schema";
import { MAX_QUESTION_CHARS, MAX_QUESTIONS, type QuestionStatus } from "../../domain/video-constants";
import { VOICE_LIMITS } from "@/domain/assistant";
import { spellingList, type Clip, type Transcriber } from "../assistant/transcribe";
import type { Db, DbOrTx } from "../db/client";
import { HttpError } from "../errors";
import type { JobLauncher } from "../jobs/launcher";
import { listPeople } from "../people";
import type { Answer } from "./prompts";

// Follow-up questions on a finished review (intent 0026, ASK-1..7). The web
// app saves the question and starts `video:question`; the worker has Gemini
// watch the playback copy again and writes the answer
// (src/worker/video/question.ts).

export const askQuestionInput = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Write a question")
    .max(MAX_QUESTION_CHARS, `Keep the question under ${MAX_QUESTION_CHARS} characters`),
});

export type VideoQuestion = {
  id: string;
  question: string;
  status: QuestionStatus;
  answer: Answer | null;
  errorMessage: string | null;
  costUsd: number | null;
  createdAt: string;
  finishedAt: string | null;
};

// A question still answering after the worker's timeout died with it (ASK-3).
const STUCK_MS = 30 * 60_000;
const STUCK_MESSAGE = "The answer didn't come back. Try again.";

function view(r: typeof videoQuestions.$inferSelect): VideoQuestion {
  return {
    id: r.id,
    question: r.question,
    status: r.status as QuestionStatus,
    answer: (r.answer as Answer | null) ?? null,
    errorMessage: r.errorMessage,
    costUsd: r.costUsd,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

// The thread, oldest first (ASK-4).
export async function listQuestions(db: DbOrTx, reviewId: string): Promise<VideoQuestion[]> {
  await db
    .update(videoQuestions)
    .set({ status: "failed", errorMessage: STUCK_MESSAGE, finishedAt: new Date() })
    .where(
      and(
        eq(videoQuestions.reviewId, reviewId),
        inArray(videoQuestions.status, ["queued", "answering"]),
        lt(videoQuestions.createdAt, new Date(Date.now() - STUCK_MS)),
      ),
    );
  const rows = await db
    .select()
    .from(videoQuestions)
    .where(eq(videoQuestions.reviewId, reviewId))
    .orderBy(asc(videoQuestions.createdAt));
  return rows.map(view);
}

// Why a review can't take a question now, or null when it can (ASK-1, ASK-3, ASK-6).
export function cannotAsk(
  review: { status: string; playbackKey: string | null; deletedAt: Date | null },
  thread: { status: QuestionStatus }[],
): string | null {
  if (review.deletedAt) return "Restore the review to ask about it.";
  if (review.status !== "done") return "Questions can be asked once the review is done.";
  if (!review.playbackKey) return "The video was deleted, so no more questions can be asked.";
  if (thread.some((q) => q.status === "queued" || q.status === "answering"))
    return "Wait for the answer to the last question.";
  if (thread.filter((q) => q.status === "done").length >= MAX_QUESTIONS)
    return `This review has had ${MAX_QUESTIONS} questions. Start a new review to ask more.`;
  return null;
}

async function start(db: Db, id: string, launcher: JobLauncher) {
  try {
    await launcher.start(["video:question", id]);
  } catch {
    await db
      .update(videoQuestions)
      .set({ status: "failed", errorMessage: "Couldn't start. Try again.", finishedAt: new Date() })
      .where(eq(videoQuestions.id, id));
  }
}

export async function askQuestion(
  db: Db,
  reviewId: string,
  input: z.infer<typeof askQuestionInput>,
  launcher: JobLauncher,
): Promise<VideoQuestion> {
  // One at a time per review, even if two asks race (ASK-3): the review
  // row is locked while the thread is checked.
  const row = await db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(videoReviews)
      .where(and(eq(videoReviews.id, reviewId), isNull(videoReviews.deletedAt)))
      .for("update");
    if (!review) throw new HttpError(404, "not found");
    const why = cannotAsk(review, await listQuestions(tx, reviewId));
    if (why) throw new HttpError(409, why);
    const [row] = await tx.insert(videoQuestions).values({ reviewId, question: input.question }).returning();
    return row;
  });
  await start(db, row.id, launcher);
  return view(row);
}

// ASK-5: a failed question is asked again.
export async function retryQuestion(db: Db, reviewId: string, questionId: string, launcher: JobLauncher) {
  await db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(videoReviews)
      .where(and(eq(videoReviews.id, reviewId), isNull(videoReviews.deletedAt)))
      .for("update");
    if (!review) throw new HttpError(404, "not found");
    const thread = await listQuestions(tx, reviewId);
    const question = thread.find((q) => q.id === questionId);
    if (!question) throw new HttpError(404, "not found");
    if (question.status !== "failed") throw new HttpError(409, "Only a failed question can be tried again.");
    const why = cannotAsk(review, thread);
    if (why) throw new HttpError(409, why);
    // Asked again now, so it moves to the end of the thread, after the
    // answers it will see.
    await tx
      .update(videoQuestions)
      .set({ status: "queued", errorMessage: null, finishedAt: null, startedAt: null, createdAt: new Date() })
      .where(eq(videoQuestions.id, questionId));
  });
  await start(db, questionId, launcher);
}

// ASK-10: a spoken question becomes words for the box, with Cookie's
// transcriber and her spelling list. The clip is held in memory for this
// call only, and the words aren't stored (ASKSEC-3); the call's cost is a
// `transcribe` round of the review, for the costs page.
// Cookie's recording limit, as base64 (intent 0007, CK-2).
const CLIP_BASE64 = Math.ceil(VOICE_LIMITS.clipBytes / 3) * 4 + 4;

export const transcribeInput = z.object({
  audio: z.object({
    data: z.string().min(1, "that recording is empty").max(CLIP_BASE64, "that recording is too big"),
    mimeType: z.string().max(40),
  }),
});

export async function transcribeQuestion(
  db: Db,
  reviewId: string,
  clip: Clip,
  transcribe: Transcriber,
): Promise<{ text: string }> {
  const [review] = await db
    .select({ id: videoReviews.id })
    .from(videoReviews)
    .where(and(eq(videoReviews.id, reviewId), isNull(videoReviews.deletedAt)));
  if (!review) throw new HttpError(404, "not found");
  const heard = await transcribe(clip, await spellingList(db, await listPeople(db)));
  await db.insert(videoReviewRounds).values({
    reviewId,
    round: "transcribe",
    model: "gemini",
    modelVersion: heard.modelVersion,
    promptVersion: "transcribe",
    output: {},
    inputTokens: heard.inputTokens,
    outputTokens: heard.outputTokens,
    costUsd: heard.costUsd,
  });
  return { text: heard.text.trim().slice(0, MAX_QUESTION_CHARS) };
}
