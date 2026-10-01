import { readFileSync } from "node:fs";
import { GenerateContentResponse, type GenerateContentParameters } from "@google/genai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { claudeModel } from "@/server/llm/claude";
import { geminiModel } from "@/server/llm/gemini";
import { costUsd } from "@/server/llm/pricing";
import { modelJsonSchema } from "@/server/llm/schema";
import { LlmError } from "@/server/llm/types";
import { reviewSchema } from "@/server/video/prompts";

// Contract tests for the model clients (plan M5.4): a recorded Vertex AI
// answer goes through the real client code, which must parse it with the
// review's schema and count tokens and cost. Gemini's answer is a real
// recording (scripts/record-video-llm.ts); Claude's is hand-written.

const fixture = (name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/llm/video/${name}.json`, "utf8")) as {
    recorded: boolean;
    model: string;
    response: Record<string, unknown>;
  };

const asGemini = (raw: Record<string, unknown>) => Object.assign(new GenerateContentResponse(), raw);
const video = { kind: "video" as const, data: Buffer.from("fake mp4"), mimeType: "video/mp4", fps: 8 };

describe("Gemini client, recorded answer", () => {
  it("parses the recorded review", async () => {
    const f = fixture("gemini-review");
    expect(f.recorded).toBe(true);
    const model = geminiModel(async () => asGemini(f.response), f.model);
    const result = await model.call({
      purpose: "review",
      system: "s",
      prompt: "p",
      schema: reviewSchema,
      media: video,
    });
    expect(reviewSchema.safeParse(result.output).success).toBe(true);
    const usage = f.response.usageMetadata as Record<string, number>;
    expect(result.inputTokens).toBe(usage.promptTokenCount);
    expect(result.outputTokens).toBe(usage.candidatesTokenCount + usage.thoughtsTokenCount);
    expect(result.costUsd).toBe(costUsd(f.model, { input: result.inputTokens, output: result.outputTokens }));
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.modelVersion).toBe(f.response.modelVersion);
  });

  it("sends the video inline with its frame rate, and the schema", async () => {
    const f = fixture("gemini-review");
    let sent: GenerateContentParameters | undefined;
    await geminiModel(async (params) => {
      sent = params;
      return asGemini(f.response);
    }).call({ purpose: "review", system: "sys", prompt: "go", schema: reviewSchema, media: video });
    const parts = (sent!.contents as { parts: Record<string, unknown>[] }[])[0].parts;
    expect(parts[0]).toMatchObject({ inlineData: { mimeType: "video/mp4" }, videoMetadata: { fps: 8 } });
    expect(parts[1]).toEqual({ text: "go" });
    expect(sent!.config).toMatchObject({
      systemInstruction: "sys",
      responseMimeType: "application/json",
      responseJsonSchema: modelJsonSchema(reviewSchema),
    });
  });

  it("reports a blocked answer as a refusal", async () => {
    const model = geminiModel(async () =>
      asGemini({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }),
    );
    await expect(
      model.call({ purpose: "review", system: "", prompt: "", schema: reviewSchema }),
    ).rejects.toMatchObject({
      kind: "refusal",
    });
  });

  it("reports a quota error in words", async () => {
    const model = geminiModel(async () => {
      throw Object.assign(new Error("429"), { status: 429 });
    });
    await expect(
      model.call({ purpose: "review", system: "", prompt: "", schema: reviewSchema }),
    ).rejects.toMatchObject({
      kind: "quota",
    });
  });

  it("rejects an answer that doesn't match the schema", async () => {
    const model = geminiModel(async () =>
      asGemini({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"summary": 3}' }] } }] }),
    );
    const err = await model
      .call({ purpose: "review", system: "", prompt: "", schema: reviewSchema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe("invalid_output");
  });
});

describe("Claude client", () => {
  const schema = z.object({ answer: z.string() });
  const response = {
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [
      { type: "thinking", thinking: "", signature: "fixture" },
      { type: "text", text: '{"answer": "yes"}' },
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 412,
      cache_creation_input_tokens: 21870,
      cache_read_input_tokens: 0,
      output_tokens: 1893,
    },
  };
  type Params = { messages: { content: Record<string, unknown>[] }[] } & Record<string, unknown>;
  const clientReturning = (answer: unknown, sent: Params[] = []) => ({
    messages: {
      create: async (params: Params) => {
        sent.push(params);
        return answer;
      },
    },
  });

  it("parses the answer and prices cache writes and reads", async () => {
    const sent: Params[] = [];
    const model = claudeModel(clientReturning(response, sent) as never, "claude-opus-5");
    const result = await model.call({ purpose: "email", system: "s", prompt: "p", schema });
    expect(result.output).toEqual({ answer: "yes" });
    expect(result.inputTokens).toBe(412 + 21870);
    expect(result.outputTokens).toBe(1893);
    expect(result.costUsd).toBe(costUsd("claude-opus-5", { input: 412, output: 1893, cacheWrite: 21870 }));
    expect(sent[0].messages[0].content).toEqual([{ type: "text", text: "p" }]);
    expect(sent[0].output_config).toMatchObject({ format: { type: "json_schema" } });
    expect(sent[0].thinking).toEqual({ type: "adaptive" });
  });

  it("reports a refusal", async () => {
    const refusal = { ...response, stop_reason: "refusal", content: [] };
    await expect(
      claudeModel(clientReturning(refusal) as never).call({
        purpose: "email",
        system: "",
        prompt: "",
        schema,
      }),
    ).rejects.toMatchObject({ kind: "refusal" });
  });

  it("tells the owner to raise the quota on a 429", async () => {
    const client = {
      messages: {
        create: async () => {
          throw Object.assign(new Error("429"), { status: 429 });
        },
      },
    };
    await expect(
      claudeModel(client as never).call({ purpose: "email", system: "", prompt: "", schema }),
    ).rejects.toThrow(/Raise the Claude quota/);
  });
});

describe("modelJsonSchema", () => {
  it("closes objects, requires every property and drops limits", () => {
    const s = JSON.stringify(modelJsonSchema(reviewSchema));
    expect(s).not.toMatch(/"minimum"|"maximum"|"minItems"|"maxItems"|"\$schema"/);
    const top = modelJsonSchema(reviewSchema) as { additionalProperties: boolean; required: string[] };
    expect(top.additionalProperties).toBe(false);
    expect(top.required).toEqual(["summary", "good", "fix", "drills", "filmNext"]);
  });
});
