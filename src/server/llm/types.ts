import type { z } from "zod";
import type { ReviewModel } from "../../domain/video-constants";

// One structured call to a model on Vertex AI (plan M5.4, spec §6.3). Gemini
// gets the video itself; Claude gets timestamped frames (F-13). Every call
// returns JSON that matches a fixed schema, plus its tokens and cost.

export type Frame = { atSec: number; jpeg: Buffer };

export type Media =
  { kind: "video"; data: Buffer; mimeType: string; fps: number } | { kind: "frames"; frames: Frame[] };

export type ModelRequest<T> = {
  // Short name of the step, e.g. "review" or "critique"; used by recorded
  // and scripted models, and in logs.
  purpose: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  media?: Media;
};

export type ModelResult<T> = {
  output: T;
  // The model ID asked for and the version that answered.
  model: string;
  modelVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export interface StructuredModel {
  readonly name: ReviewModel;
  // What this model is sent: the video or frames (shown on the scoreboard).
  readonly input: Media["kind"];
  call<T>(request: ModelRequest<T>): Promise<ModelResult<T>>;
}

export type LlmErrorKind = "refusal" | "invalid_output" | "quota" | "unavailable" | "too_large";

// A model call that failed, in words the review page can show (VID-5).
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
