// Records Gemini's raw answers to each debate step for the contract tests
// (plan M5.4): `VERTEX_PROJECT=<project> pnpm exec tsx scripts/record-video-llm.ts`.
// Uses Vertex AI with Application Default Credentials and a synthetic
// test-pattern clip, never a real video. Costs well under $1.
import { readFileSync, writeFileSync } from "node:fs";
import { GoogleGenAI, type GenerateContentParameters } from "@google/genai";
import type { ZodType } from "zod";
import { geminiModel, GEMINI_MODEL } from "../src/server/llm/gemini";
import { fakeReview, marker } from "../src/server/video/fake";
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
    input: "video",
  };
  const clean = (m: "gemini" | "claude") => {
    const r = fakeReview(m);
    return { ...r, summary: r.summary.replace(marker(m), "").trim() };
  };
  const a = clean("gemini");
  const b = { ...clean("claude"), summary: "Solid contact, but the take-back is late." };
  const rebuttal: p.Rebuttal = {
    replies: [
      { point: "Finish over the shoulder", response: "concede", argument: "It's out of frame.", at: null },
    ],
  };
  const steps: [string, string, string, ZodType][] = [
    ["review", p.reviewerSystem(), p.reviewPrompt(ctx), p.reviewSchema],
    ["critique", p.judgeSystem(), p.critiquePrompt(ctx, a, b), p.critiqueSchema],
    ["rebuttal", p.rebuttalSystem(), p.rebuttalPrompt(ctx, a, []), p.rebuttalSchema],
    [
      "final_score",
      p.judgeSystem(),
      p.finalScorePrompt(ctx, a, b, { A: rebuttal, B: rebuttal }),
      p.finalScoreSchema,
    ],
    [
      "combine",
      p.combineSystem(),
      p.combinePrompt(ctx, a, b, [], { A: rebuttal, B: rebuttal }),
      p.combinedSchema,
    ],
  ];
  let total = 0;
  for (const [purpose, system, prompt, schema] of steps) {
    const result = await gemini.call({ purpose, system, prompt, schema, media });
    total += result.costUsd;
    writeFileSync(
      `tests/fixtures/llm/video/gemini-${purpose}.json`,
      JSON.stringify(
        { recorded: true, model: GEMINI_MODEL(), promptVersion: p.PROMPT_VERSION, response: last },
        null,
        2,
      ) + "\n",
    );
    console.log(purpose, result.inputTokens, result.outputTokens, result.costUsd);
  }
  console.log("total $", total.toFixed(4));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
