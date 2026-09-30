import type { ReviewMode, SportSource, VideoSport } from "../../domain/video-constants";
import { LlmError, type Media } from "../llm/types";
import type { Models, RoundRecord } from "./debate";
import { detectPrompt, detectSchema, detectSystem, PROMPT_VERSION } from "./prompts";

// Working out the sport before the review (intent 0005, SPT-2, SPT-3): one
// call to the model the review mode uses first (Gemini with the clip, or
// Claude with frames in Claude-only mode). An unsure answer, or a model
// that fails, leaves the review as "other" and marked unsure: detection
// never fails the review.

export type Detection = { sport: VideoSport; source: SportSource; round: RoundRecord | null };

export async function detectSport(
  mode: ReviewMode,
  models: Models,
  media: Media,
  log: (message: string, fields: Record<string, unknown>) => void = () => {},
): Promise<Detection> {
  const model = models[mode === "claude" ? "claude" : "gemini"];
  try {
    const result = await model.call({
      purpose: "detect",
      system: detectSystem(),
      prompt: detectPrompt(model.input),
      schema: detectSchema,
      media,
    });
    const { sport, sure } = result.output;
    const round: RoundRecord = {
      round: "detect",
      model: model.name,
      modelVersion: result.modelVersion,
      promptVersion: PROMPT_VERSION,
      labels: null,
      output: result.output,
      scores: null,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    };
    return sure ? { sport, source: "detected", round } : { sport: "other", source: "unsure", round };
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    log("sport not detected", { error: err.message });
    return { sport: "other", source: "unsure", round: null };
  }
}
