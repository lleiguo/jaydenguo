import type { ReviewRound } from "../../domain/video-constants";
import { LlmError, type Media, type StructuredModel } from "../llm/types";
import {
  PROMPT_VERSION,
  reviewerSystem,
  reviewPrompt,
  reviewSchema,
  type Review,
  type ReviewContext,
} from "./prompts";

// The review (spec VID-3, §6.3): one call to Gemini with the video.

export type RoundRecord = {
  round: ReviewRound;
  model: string;
  modelVersion: string;
  promptVersion: string;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type ReviewHooks = {
  progress?: (text: string) => Promise<void> | void;
  saveRound?: (round: RoundRecord) => Promise<void> | void;
};

export async function runReview(
  model: StructuredModel,
  input: { context: ReviewContext; media: Media | undefined },
  hooks: ReviewHooks = {},
): Promise<{ review: Review; costUsd: number }> {
  await hooks.progress?.("Reviewing the video");
  const request = {
    purpose: "review",
    system: reviewerSystem(),
    prompt: reviewPrompt(input.context),
    schema: reviewSchema,
    media: input.media,
  };
  const result = await withRetry(() => model.call(request));
  await hooks.saveRound?.({
    round: "review",
    model: model.name,
    modelVersion: result.modelVersion,
    promptVersion: PROMPT_VERSION,
    output: result.output,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  });
  return { review: result.output, costUsd: result.costUsd };
}

// A malformed answer is asked for once more; anything else fails the step.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LlmError && err.kind === "invalid_output") return fn();
    throw err;
  }
}
