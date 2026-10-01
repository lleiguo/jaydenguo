import { scriptedModel, type ScriptedModel } from "../llm/scripted";
import type { ModelRequest } from "../llm/types";
import type { Detected, Review } from "./prompts";

// A stand-in model that answers every step with fixed, valid output: for
// tests, and for trying the video pages locally without Vertex AI
// (VIDEO_LLM=fake; refused in production).

export function fakeReview(): Review {
  return {
    summary: "A steady, balanced swing with room to prepare earlier.",
    good: [
      { text: "Watches the ball onto the strings", at: "0:03", why: "Head stays still through contact" },
    ],
    fix: [
      { text: "Turn the shoulders sooner", at: "0:02", why: "The racket starts back late" },
      { text: "Finish over the shoulder", at: "0:04", why: "The swing stops at the waist" },
    ],
    drills: [{ name: "Shadow swings", how: "Turn, swing and freeze at the finish", reps: "3 sets of 10" }],
    filmNext: "Film from the side, level with the hitting zone.",
  };
}

export type FakeOptions = {
  // What detection answers (intent 0005); tennis, sure, by default.
  detect?: Detected;
};

export function fakeScript(opts: FakeOptions = {}) {
  return (req: ModelRequest<unknown>): unknown => {
    switch (req.purpose) {
      case "detect":
        return (opts.detect ?? {
          sport: "tennis",
          sure: true,
          reason: "A racket and a tennis court.",
        }) satisfies Detected;
      case "review":
        return fakeReview();
      default:
        throw new Error(`no fake answer for ${req.purpose}`);
    }
  };
}

export function fakeModel(opts: FakeOptions = {}): ScriptedModel {
  return scriptedModel("gemini", fakeScript(opts));
}
