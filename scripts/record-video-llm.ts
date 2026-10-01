// Records Gemini's raw answer to the review for the contract test (plan
// M5.4): `VERTEX_PROJECT=<project> pnpm exec tsx scripts/record-video-llm.ts`.
// Uses Vertex AI with Application Default Credentials and a synthetic
// test-pattern clip, never a real video. Costs a few cents.
import { readFileSync, writeFileSync } from "node:fs";
import { GoogleGenAI, type GenerateContentParameters } from "@google/genai";
import { geminiModel, GEMINI_MODEL } from "../src/server/llm/gemini";
import * as p from "../src/server/video/prompts";

async function main() {
  const project = process.env.VERTEX_PROJECT;
  if (!project) throw new Error("set VERTEX_PROJECT");
  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location: process.env.GEMINI_VERTEX_REGION ?? "global",
  });
  let last: unknown = null;
  const gemini = geminiModel(async (params: GenerateContentParameters) => {
    const res = await ai.models.generateContent(params);
    // Thought signatures are opaque and large; the client doesn't use them.
    last = JSON.parse(JSON.stringify(res), (k, v) =>
      k === "thoughtSignature" || k === "sdkHttpResponse" ? undefined : v,
    );
    return res;
  });
  const media = {
    kind: "video" as const,
    data: readFileSync("tests/fixtures/video/test-pattern-6s.mp4"),
    mimeType: "video/mp4",
    fps: 4,
  };
  const ctx: p.ReviewContext = {
    sport: "tennis",
    note: "Test clip: a moving test pattern, not a real swing.",
  };
  const result = await gemini.call({
    purpose: "review",
    system: p.reviewerSystem(),
    prompt: p.reviewPrompt(ctx),
    schema: p.reviewSchema,
    media,
  });
  writeFileSync(
    "tests/fixtures/llm/video/gemini-review.json",
    JSON.stringify(
      { recorded: true, model: GEMINI_MODEL(), promptVersion: p.PROMPT_VERSION, response: last },
      null,
      2,
    ) + "\n",
  );
  console.log("review", result.inputTokens, result.outputTokens, "$", result.costUsd.toFixed(4));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
