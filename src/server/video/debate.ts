import type { ZodType } from "zod";
import { other, type ReviewModel, type ReviewMode, type ReviewRound } from "../../domain/video-constants";
import { LlmError, type Media, type ModelResult, type StructuredModel } from "../llm/types";
import {
  combinePrompt,
  combinedSchema,
  combineSystem,
  critiquePrompt,
  critiqueSchema,
  finalScorePrompt,
  finalScoreSchema,
  judgeSystem,
  PROMPT_VERSION,
  rebuttalPrompt,
  rebuttalSchema,
  rebuttalSystem,
  reviewerSystem,
  reviewPrompt,
  reviewSchema,
  total,
  type Combined,
  type Critique,
  type Rebuttal,
  type Review,
  type ReviewContext,
  type Scores,
} from "./prompts";

// The debate (spec VID-3a..3c, §6.3, plan M5.5):
// 1. both models review the video independently;
// 2. each judges both reviews, blind, as Review A and B in its own random
//    order, and scores them on the rubric;
// 3. each author replies once to the critiques of its own review;
// 4. both judges re-score with the replies in view;
// 5. the winner writes the combined review.
// The winner has the higher average of the two judges' final totals; within
// 1 point it's a tie (the higher average still writes the combined review).
// Each judge's score of its own review is its self-score: it counts like any
// score, and the gap to the other judge's score of the same review is
// reported as self-preference (VID-3d). Single-model mode (VID-3e) is round
// 1 by one model.

export type Models = Record<ReviewModel, StructuredModel>;

export type RoundRecord = {
  round: ReviewRound;
  model: ReviewModel;
  modelVersion: string;
  promptVersion: string;
  // What this judge saw as A and B.
  labels: Labels | null;
  output: unknown;
  // Per reviewed model, the judge's scores and total.
  scores: Partial<Record<ReviewModel, Scores & { total: number }>> | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type Labels = { A: ReviewModel; B: ReviewModel };

export type Verdict = {
  winner: ReviewModel;
  tie: boolean;
  margin: number;
  // Average of the two judges' final totals, out of 25.
  totals: Record<ReviewModel, number>;
  // judge -> reviewed model -> final total.
  finalScores: Record<ReviewModel, Record<ReviewModel, number>>;
  // Each model's final score of its own review, and how far it's above the
  // other judge's score of that review.
  selfScores: Record<ReviewModel, { own: number; other: number; preference: number }>;
};

export type DebateResult = {
  mode: ReviewMode;
  reviews: Partial<Record<ReviewModel, Review>>;
  verdict: Verdict | null;
  combined: Combined | Review;
  costUsd: number;
};

export type DebateHooks = {
  progress?: (text: string) => Promise<void> | void;
  saveRound?: (round: RoundRecord) => Promise<void> | void;
  // For tests: which review each judge sees as A. Defaults to a coin flip.
  random?: () => number;
};

export type DebateInput = {
  context: Omit<ReviewContext, "input">;
  media: Record<ReviewModel, Media | undefined>;
};

const tie = 1;

export async function runDebate(
  mode: ReviewMode,
  models: Models,
  input: DebateInput,
  hooks: DebateHooks = {},
): Promise<DebateResult> {
  const random = hooks.random ?? Math.random;
  let cost = 0;
  const ctx = (m: ReviewModel): ReviewContext => ({ ...input.context, input: models[m].input });

  async function call<T>(
    round: ReviewRound,
    m: ReviewModel,
    req: { system: string; prompt: string; schema: ZodType<T> },
    extra: { labels?: Labels; scores?: RoundRecord["scores"] } = {},
  ): Promise<ModelResult<T>> {
    const result = await withRetry(() => models[m].call({ purpose: round, ...req, media: input.media[m] }));
    cost += result.costUsd;
    await hooks.saveRound?.({
      round,
      model: m,
      modelVersion: result.modelVersion,
      promptVersion: PROMPT_VERSION,
      labels: extra.labels ?? null,
      output: result.output,
      scores: extra.scores ?? null,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    });
    return result;
  }

  const review = (m: ReviewModel) =>
    call("review", m, { system: reviewerSystem(), prompt: reviewPrompt(ctx(m)), schema: reviewSchema });

  if (mode !== "debate") {
    await hooks.progress?.(`Reviewing the video (${mode === "gemini" ? "Gemini" : "Claude"})`);
    const r = await review(mode);
    return { mode, reviews: { [mode]: r.output }, verdict: null, combined: r.output, costUsd: cost };
  }

  // Round 1: two independent reviews.
  await hooks.progress?.("Round 1 of 5: two independent reviews");
  const [g, c] = await Promise.all([review("gemini"), review("claude")]);
  const reviews: Record<ReviewModel, Review> = { gemini: g.output, claude: c.output };

  // Each judge's blind labels, fixed for rounds 2 and 4.
  const labelsFor = (): Labels =>
    random() < 0.5 ? { A: "gemini", B: "claude" } : { A: "claude", B: "gemini" };
  const labels: Record<ReviewModel, Labels> = { gemini: labelsFor(), claude: labelsFor() };
  const byLabel = <T extends { label: "A" | "B" }>(judge: ReviewModel, items: T[], who: string) => {
    const a = items.find((i) => i.label === "A");
    const b = items.find((i) => i.label === "B");
    if (!a || !b) throw new LlmError("invalid_output", `${who} didn't judge both reviews.`);
    return { [labels[judge].A]: a, [labels[judge].B]: b } as Record<ReviewModel, T>;
  };
  const scoreMap = <T extends { scores: Scores }>(m: Record<ReviewModel, T>) =>
    Object.fromEntries(
      Object.entries(m).map(([k, v]) => [k, { ...v.scores, total: total(v.scores) }]),
    ) as RoundRecord["scores"];
  const judgeName = (m: ReviewModel) => (m === "gemini" ? "Gemini" : "Claude");

  // Round 2: critiques and scores.
  await hooks.progress?.("Round 2 of 5: each model critiques and scores both reviews");
  const critiques = {} as Record<ReviewModel, Record<ReviewModel, Critique["reviews"][number]>>;
  await Promise.all(
    (["gemini", "claude"] as const).map(async (judge) => {
      const l = labels[judge];
      // Saved after mapping, so the stored scores are per reviewed model.
      const result = await withRetry(() =>
        models[judge].call({
          purpose: "critique",
          system: judgeSystem(),
          prompt: critiquePrompt(ctx(judge), reviews[l.A], reviews[l.B]),
          schema: critiqueSchema,
          media: input.media[judge],
        }),
      );
      const mapped = byLabel(judge, result.output.reviews, judgeName(judge));
      critiques[judge] = mapped;
      cost += result.costUsd;
      await hooks.saveRound?.(record("critique", judge, result, l, scoreMap(mapped)));
    }),
  );

  // Round 3: each author replies to the critiques of its own review.
  await hooks.progress?.("Round 3 of 5: each model replies to the critiques of its review");
  const rebuttals = {} as Record<ReviewModel, Rebuttal>;
  await Promise.all(
    (["gemini", "claude"] as const).map(async (author) => {
      const aboutMine = [critiques.gemini[author], critiques.claude[author]];
      if (random() < 0.5) aboutMine.reverse();
      const r = await call("rebuttal", author, {
        system: rebuttalSystem(),
        prompt: rebuttalPrompt(ctx(author), reviews[author], aboutMine),
        schema: rebuttalSchema,
      });
      rebuttals[author] = r.output;
    }),
  );

  // Round 4: final scores, same labels as round 2.
  await hooks.progress?.("Round 4 of 5: final scores");
  const finalScores = {} as Record<ReviewModel, Record<ReviewModel, number>>;
  await Promise.all(
    (["gemini", "claude"] as const).map(async (judge) => {
      const l = labels[judge];
      const result = await withRetry(() =>
        models[judge].call({
          purpose: "final_score",
          system: judgeSystem(),
          prompt: finalScorePrompt(ctx(judge), reviews[l.A], reviews[l.B], {
            A: rebuttals[l.A],
            B: rebuttals[l.B],
          }),
          schema: finalScoreSchema,
          media: input.media[judge],
        }),
      );
      const mapped = byLabel(judge, result.output.reviews, judgeName(judge));
      finalScores[judge] = { gemini: total(mapped.gemini.scores), claude: total(mapped.claude.scores) };
      cost += result.costUsd;
      await hooks.saveRound?.(record("final_score", judge, result, l, scoreMap(mapped)));
    }),
  );

  const verdict = decide(finalScores);

  // Round 5: the winner writes the combined review, seeing the two reviews
  // in its own round-2 order.
  await hooks.progress?.("Round 5 of 5: the combined review");
  const w = verdict.winner;
  const l = labels[w];
  const relabel = (judge: ReviewModel) =>
    (["A", "B"] as const).map((label) => ({ ...critiques[judge][l[label]], label }));
  const combined = await call("combine", w, {
    system: combineSystem(),
    prompt: combinePrompt(ctx(w), reviews[l.A], reviews[l.B], [relabel("gemini"), relabel("claude")], {
      A: rebuttals[l.A],
      B: rebuttals[l.B],
    }),
    schema: combinedSchema,
  });

  const kept = dropConceded(combined.output, [rebuttals.gemini, rebuttals.claude]);
  return { mode, reviews, verdict, combined: kept, costUsd: round4(cost) };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// §6.3 round 5: conceded points don't survive. The combined review is asked
// to drop them; this removes any it kept whose text matches a conceded point.
export function dropConceded(combined: Combined, rebuttals: Rebuttal[]): Combined {
  const conceded = rebuttals
    .flatMap((r) => r.replies)
    .filter((r) => r.response === "concede")
    .map((r) => norm(r.point))
    .filter((p) => p.length >= 8);
  const survives = (p: { text: string }) => {
    const t = norm(p.text);
    return !conceded.some((c) => t === c || t.includes(c) || c.includes(t));
  };
  return { ...combined, good: combined.good.filter(survives), fix: combined.fix.filter(survives) };
}

function record(
  round: ReviewRound,
  model: ReviewModel,
  result: ModelResult<unknown>,
  labels: Labels,
  scores: RoundRecord["scores"],
): RoundRecord {
  return {
    round,
    model,
    modelVersion: result.modelVersion,
    promptVersion: PROMPT_VERSION,
    labels,
    output: result.output,
    scores,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  };
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
const round1 = (x: number) => Math.round(x * 10) / 10;

// The verdict from the two judges' final totals (VID-3c).
export function decide(finalScores: Record<ReviewModel, Record<ReviewModel, number>>): Verdict {
  const avg = (m: ReviewModel) => (finalScores.gemini[m] + finalScores.claude[m]) / 2;
  const totals = { gemini: round1(avg("gemini")), claude: round1(avg("claude")) };
  const margin = round1(Math.abs(totals.gemini - totals.claude));
  // Equal averages: Gemini writes (it saw the whole video, F-13).
  const winner: ReviewModel = totals.claude > totals.gemini ? "claude" : "gemini";
  const self = (m: ReviewModel) => ({
    own: finalScores[m][m],
    other: finalScores[other(m)][m],
    preference: finalScores[m][m] - finalScores[other(m)][m],
  });
  return {
    winner,
    tie: margin <= tie,
    margin,
    totals,
    finalScores,
    selfScores: { gemini: self("gemini"), claude: self("claude") },
  };
}

// A malformed answer is asked for once more; anything else fails the step.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LlmError && err.kind === "invalid_output") return fn();
    throw err;
  }
}
