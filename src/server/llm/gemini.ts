import {
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import { costUsd } from "./pricing";
import { modelJsonSchema, parseAnswer } from "./schema";
import { LlmError, type ModelRequest, type ModelResult, type StructuredModel } from "./types";

// Gemini on Vertex AI (plan M5.4, spikes.md SP-6). It reads the video
// itself, sent inline with the frame rate the sport needs, and answers in
// JSON that matches the request's schema.

export const GEMINI_MODEL = () => process.env.GEMINI_MODEL ?? "gemini-3.1-pro-preview";

// Inline video above this size is refused by Vertex AI; media prep keeps
// clips under it (src/worker/video/media.ts).
export const GEMINI_INLINE_LIMIT = 19 * 1024 * 1024;

export type Generate = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

export function vertexGenerate(): Generate {
  const project = process.env.VERTEX_PROJECT;
  if (!project) throw new LlmError("unavailable", "Vertex AI isn't set up (VERTEX_PROJECT is missing).");
  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location: process.env.GEMINI_VERTEX_REGION ?? "global",
  });
  return (params) => ai.models.generateContent(params);
}

const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);

export function geminiModel(generate: Generate = vertexGenerate(), model = GEMINI_MODEL()): StructuredModel {
  return {
    name: "gemini",
    async call<T>(req: ModelRequest<T>): Promise<ModelResult<T>> {
      const parts: Part[] = [];
      if (req.media) {
        if (req.media.data.length > GEMINI_INLINE_LIMIT)
          throw new LlmError(
            "too_large",
            "The video is too large to send to Gemini. Pick a shorter segment.",
          );
        parts.push({
          inlineData: { mimeType: req.media.mimeType, data: req.media.data.toString("base64") },
          videoMetadata: { fps: req.media.fps },
        });
      }
      parts.push({ text: req.prompt });
      let response: GenerateContentResponse;
      try {
        response = await generate({
          model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: modelJsonSchema(req.schema),
            maxOutputTokens: 32_000,
          },
        });
      } catch (err) {
        throw geminiError(err);
      }
      const candidate = response.candidates?.[0];
      if (
        response.promptFeedback?.blockReason ||
        (candidate?.finishReason && BLOCKED.has(candidate.finishReason))
      )
        throw new LlmError(
          "refusal",
          req.media ? "Gemini declined to review this video." : "Gemini declined to answer this.",
        );
      if (candidate?.finishReason === "MAX_TOKENS")
        throw new LlmError("invalid_output", "Gemini's answer was cut off before it finished.");
      const text = response.text ?? "";
      const output = parseAnswer(req.schema, text, "Gemini");
      const usage = response.usageMetadata;
      const input = usage?.promptTokenCount ?? 0;
      const output_ = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
      return {
        output,
        model,
        modelVersion: response.modelVersion ?? model,
        inputTokens: input,
        outputTokens: output_,
        costUsd: costUsd(model, { input, output: output_ }),
      };
    },
  };
}

function geminiError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const status = (err as { status?: number }).status;
  if (status === 429)
    return new LlmError(
      "quota",
      "Gemini is busy or over its quota on Vertex AI. Try again in a few minutes.",
    );
  if (status === 400)
    return new LlmError(
      "unavailable",
      "Gemini couldn't read this request (the video may be in an unusual format).",
    );
  return new LlmError("unavailable", "Gemini on Vertex AI didn't answer. Try again later.");
}
