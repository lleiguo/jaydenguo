import type { ReviewModel } from "../../domain/video-constants";
import { scriptedModel, type ScriptedModel } from "../llm/scripted";
import type { ModelRequest } from "../llm/types";
import type { Models } from "./debate";
import type { Combined, Critique, FinalScore, Rebuttal, Review, Scores } from "./prompts";

// Stand-in models that answer every debate step with fixed, valid output:
// for tests, and for trying the video pages locally without Vertex AI
// (VIDEO_LLM=fake; refused in production). Each fake review carries a
// marker, so a fake judge can find which blind label is which and score
// them as the test asks; real judges never get such a marker.

export const marker = (m: ReviewModel) => `[${m}-review]`;

export function fakeReview(m: ReviewModel): Review {
  return {
    summary: `${marker(m)} A steady, balanced swing with room to prepare earlier.`,
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

const flat = (n: number): Scores => ({
  grounded: n,
  correct: n,
  ageAppropriate: n,
  actionable: n,
  prioritised: n,
});

export type FakeOptions = {
  // Each judge's per-criterion score for each model's review: every
  // criterion gets this number, so a review's total is five times it.
  critique?: Record<ReviewModel, Record<ReviewModel, number>>;
  final?: Record<ReviewModel, Record<ReviewModel, number>>;
  concede?: boolean;
};

const DEFAULT = { gemini: { gemini: 4, claude: 3 }, claude: { gemini: 4, claude: 4 } };

// Finds which label a review in the prompt carries: the text after
// "Review A:" up to "Review B" holds A's marker.
function whoIs(prompt: string, label: "A" | "B"): ReviewModel {
  const start = prompt.indexOf(`Review ${label}:`);
  const rest = prompt.slice(start);
  const g = rest.indexOf(marker("gemini"));
  const c = rest.indexOf(marker("claude"));
  if (g === -1) return "claude";
  if (c === -1) return "gemini";
  return g < c ? "gemini" : "claude";
}

export function fakeScript(judge: ReviewModel, opts: FakeOptions = {}) {
  return (req: ModelRequest<unknown>): unknown => {
    const scores = (table: Record<ReviewModel, Record<ReviewModel, number>>, label: "A" | "B") =>
      flat(table[judge][whoIs(req.prompt, label)]);
    switch (req.purpose) {
      case "review":
        return fakeReview(judge);
      case "critique":
        return {
          reviews: (["A", "B"] as const).map((label) => ({
            label,
            scores: scores(opts.critique ?? DEFAULT, label),
            unsupported: [],
            errors: [{ point: "Finish over the shoulder", reason: "The finish isn't in frame at 0:04" }],
            missed: ["The ready position between shots"],
            comment: "Clear and mostly grounded.",
          })),
        } satisfies Critique;
      case "rebuttal":
        return {
          replies: [
            {
              point: "Finish over the shoulder",
              response: opts.concede ? "concede" : "defend",
              argument: opts.concede ? "Right, the finish is cut off." : "The follow-through shows at 0:04.",
              at: "0:04",
            },
          ],
        } satisfies Rebuttal;
      case "final_score":
        return {
          reviews: (["A", "B"] as const).map((label) => ({
            label,
            scores: scores(opts.final ?? opts.critique ?? DEFAULT, label),
            reason: "After the replies.",
          })),
        } satisfies FinalScore;
      case "combine":
        return {
          summary: "Good contact; prepare earlier.",
          good: [
            {
              text: "Watches the ball onto the strings",
              at: "0:03",
              why: "Head still at contact",
              status: "agreed",
              sides: null,
            },
          ],
          fix: [
            {
              text: "Turn the shoulders sooner",
              at: "0:02",
              why: "Late take-back",
              status: "agreed",
              sides: null,
            },
            // Kept even when conceded, as a careless model might; the
            // debate removes it (dropConceded).
            {
              text: "Finish over the shoulder",
              at: "0:04",
              why: "Short finish",
              status: "disputed",
              sides: { for: "The swing stops early.", against: "The finish is out of frame." },
            },
          ],
          drills: [{ name: "Shadow swings", how: "Turn, swing, freeze", reps: "3 sets of 10" }],
          filmNext: "Film from the side.",
        } satisfies Combined;
      default:
        throw new Error(`no fake answer for ${req.purpose}`);
    }
  };
}

export function fakeModels(opts: FakeOptions = {}): Models & Record<ReviewModel, ScriptedModel> {
  return {
    gemini: scriptedModel("gemini", "video", fakeScript("gemini", opts)),
    claude: scriptedModel("claude", "frames", fakeScript("claude", opts)),
  };
}
