import type { z } from "zod";

// One structured call to a model on Vertex AI (plan M5.4, spec §6.3). Every
// call returns JSON that matches a fixed schema, plus its tokens and cost.

// A video, sent to Gemini inline.
export type Media = { kind: "video"; data: Buffer; mimeType: string; fps: number };

export type ModelRequest<T> = {
  // Short name of the step, e.g. "review" or "detect"; used by recorded
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
  readonly name: "gemini" | "claude";
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
