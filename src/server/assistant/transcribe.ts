import { FunctionCallingConfigMode } from "@google/genai";
import { count, desc, isNotNull, sql } from "drizzle-orm";
import { events } from "@db/schema";
import { LIMITS, VOICE_LIMITS } from "@/domain/assistant";
import type { Person } from "@/domain/people";
import type { DbOrTx } from "../db/client";
import { vertexGenerate, type Generate } from "../llm/gemini";
import { costUsd } from "../llm/pricing";
import { LlmError } from "../llm/types";
import { ASSISTANT_MODEL } from "./model";

// A spoken question becomes text before Cookie looks anything up (intent
// 0007, VOX-1..3; plan SP-C1). The clip is held in memory for this one
// call and never written anywhere (CSEC-2).

export type Clip = { data: Buffer; mimeType: string };

export type Transcript = {
  // The words as spoken; empty when there were none to make out.
  text: string;
  model: string;
  modelVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type Transcriber = (clip: Clip, names: readonly string[]) => Promise<Transcript>;

// VOX-3: the names she should spell right: the people, then the places the
// calendar names most often ("Elm Street School, Room 4" counts as "Elm
// Street School"). Street addresses are left out.
export async function spellingList(db: DbOrTx, people: readonly Person[]): Promise<string[]> {
  const place = sql<string>`trim(split_part(${events.locationName}, ',', 1))`;
  const places = await db
    .select({ name: place })
    .from(events)
    .where(isNotNull(events.locationName))
    .groupBy(place)
    .orderBy(desc(count()), place)
    .limit(VOICE_LIMITS.spellingNames * 2);
  const names = places.map((p) => p.name).filter((n) => n.length >= 2 && n.length <= 40 && !/^\d/.test(n));
  return [...new Set([...people.map((p) => p.name), ...names])].slice(0, VOICE_LIMITS.spellingNames);
}

export const transcribePrompt = (names: readonly string[]) =>
  "Transcribe the spoken question exactly as said: the same words and languages, Chinese in simplified characters, English as English, not translated. " +
  "If there is no speech, or none you can make out, give an empty text. Never answer the question." +
  (names.length ? ` Names you may hear: ${names.join(", ")}.` : "");

const HEARD = {
  name: "heard",
  description: "Give the transcript.",
  parametersJsonSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
};

export function geminiTranscriber(
  generate: Generate = vertexGenerate(),
  model = ASSISTANT_MODEL(),
): Transcriber {
  return async (clip, names) => {
    let response;
    try {
      response = await generate({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { text: transcribePrompt(names) },
              { inlineData: { mimeType: clip.mimeType, data: clip.data.toString("base64") } },
            ],
          },
        ],
        config: {
          tools: [{ functionDeclarations: [HEARD] }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: LIMITS.outputTokens,
          httpOptions: {
            timeout: LIMITS.roundTimeoutMs,
            retryOptions: { attempts: 2, initialDelay: 0.3, maxDelay: 1 },
          },
        },
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new LlmError(
        status === 429 ? "quota" : "unavailable",
        status === 429 ? "Gemini is busy or over its quota." : "Gemini didn't answer.",
      );
    }
    if (response.promptFeedback?.blockReason) throw new LlmError("refusal", "Gemini declined to listen.");
    const call = response.functionCalls?.find((c) => c.name === "heard");
    const text = (call?.args as { text?: unknown } | undefined)?.text;
    const usage = response.usageMetadata;
    const input = usage?.promptTokenCount ?? 0;
    const output = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
    return {
      text: typeof text === "string" ? text.trim() : "",
      model,
      modelVersion: response.modelVersion ?? model,
      inputTokens: input,
      outputTokens: output,
      costUsd: costUsd(model, { input, output }),
    };
  };
}

// For tests and ASSISTANT_LLM=fake: every clip was this question.
export const scriptedTranscriber =
  (heard: string | ((clip: Clip, names: readonly string[]) => string)): Transcriber =>
  async (clip, names) => ({
    text: typeof heard === "string" ? heard : heard(clip, names),
    model: "assistant-scripted",
    modelVersion: "assistant-scripted",
    inputTokens: 100,
    outputTokens: 10,
    costUsd: 0.0001,
  });
