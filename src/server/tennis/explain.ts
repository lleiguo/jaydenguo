import { createHash } from "node:crypto";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { inArray } from "drizzle-orm";
import { tennisExplanations } from "@db/schema";
import type { Db, DbOrTx } from "../db/client";
import type { Logger } from "../log";
import { listTournaments, predictAgainst, type PredictionView } from "./load";

// The "why" in words (TEN-6, spec §6.1, plan M3.6): Claude on Vertex AI
// writes one plain-language paragraph from the computed numbers only. It
// never sees names, pages or profiles, and it doesn't choose the
// probability. Each set of numbers is explained once and stored with the
// prompt version and model, so the pages never wait on a model call.

export const PROMPT_VERSION = "tennis-explain-1";
const MAX_PER_RUN = 5;

export const SYSTEM_PROMPT = `You explain tennis match predictions to a parent whose child plays junior tournaments.
You get the numbers a rating model computed for one upcoming singles match: "player" is their child and "opponent" is the other child. You never get names.

Write one short paragraph (at most 90 words) in plain, warm, factual language:
- State the win probability exactly as given, as a whole percentage, and call it an estimate.
- Explain which inputs matter most: the rating gap and how certain the ratings are, head-to-head meetings, recent form (last 10 matches) and share of games won.
- Say what the confidence level means in this case (for example, few rated matches).
- Refer to the players as "he" and "his opponent". Do not invent facts, names, scores or advice about tactics.
- Never give a different probability or say the result is certain.
Reply with the paragraph only.`;

const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => Math.round(x * 100);

// What Claude is sent: rounded numbers, nothing else.
export function explanationInputs(p: PredictionView) {
  const side = (s: PredictionView["a"]) => ({
    rating: Math.round(s.rating),
    ratingDeviation: Math.round(s.rd),
    ratedMatches: s.ratedMatches,
    last10: s.last,
    gamesWonPercent: s.gameShare === null ? null : pct(s.gameShare),
  });
  return {
    winProbabilityPercent: pct(p.probability),
    fromRatingsAlonePercent: pct(p.base),
    adjustmentsLogOdds: {
      headToHead: r2(p.adjustments.headToHead),
      recentForm: r2(p.adjustments.form),
      marginOfVictory: r2(p.adjustments.margin),
    },
    confidence: p.confidence,
    likelyScoreBand: p.band,
    player: side(p.a),
    opponent: side(p.b),
    headToHead: p.headToHead,
  };
}
export type ExplanationInputs = ReturnType<typeof explanationInputs>;

export const inputsHash = (inputs: ExplanationInputs) =>
  createHash("sha256")
    .update(`${PROMPT_VERSION}\n${JSON.stringify(inputs)}`)
    .digest("hex");

export type Explained = {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};
export type Explainer = (inputs: ExplanationInputs) => Promise<Explained | null>;

// The stored explanations for these predictions, by prediction.
export async function explanationsFor(
  db: DbOrTx,
  predictions: (PredictionView | null)[],
): Promise<Map<PredictionView, string>> {
  const wanted = predictions
    .filter((p): p is PredictionView => p !== null)
    .map((p) => ({ p, hash: inputsHash(explanationInputs(p)) }));
  const out = new Map<PredictionView, string>();
  if (!wanted.length) return out;
  const rows = await db
    .select({ hash: tennisExplanations.inputsHash, text: tennisExplanations.text })
    .from(tennisExplanations)
    .where(
      inArray(
        tennisExplanations.inputsHash,
        wanted.map((w) => w.hash),
      ),
    );
  const byHash = new Map(rows.map((r) => [r.hash, r.text]));
  for (const w of wanted) {
    const text = byHash.get(w.hash);
    if (text) out.set(w.p, text);
  }
  return out;
}

export const CLAUDE_MODEL = () => process.env.CLAUDE_MODEL ?? "claude-opus-5";

// Claude on Vertex AI, or null when the project isn't configured (local
// development and tests without recorded responses).
export function claudeExplainer(): Explainer | null {
  const projectId = process.env.VERTEX_PROJECT;
  if (!projectId) return null;
  const client = new AnthropicVertex({ projectId, region: process.env.CLAUDE_VERTEX_REGION ?? "global" });
  return async (inputs) => {
    const model = CLAUDE_MODEL();
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(inputs, null, 2) }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) return null;
    return {
      text,
      model: response.model ?? model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  };
}

// After a tennis sync: explain the predictions for his next matches that
// don't have an explanation yet. Best effort; a failure never fails the
// sync, and the page shows the numbers without the paragraph.
export async function explainNextMatches(db: Db, explainer: Explainer | null, log: Logger) {
  if (!explainer) return { explained: 0, skipped: "not configured" as const };
  const { data, nextMatches } = await listTournaments(db);
  const predictions = nextMatches
    .map((n) => (n.draw.opponentKey ? predictAgainst(data, n.draw.opponentKey) : null))
    .filter((p): p is PredictionView => p !== null);
  const have = await explanationsFor(db, predictions);
  let explained = 0;
  for (const p of predictions.filter((x) => !have.has(x)).slice(0, MAX_PER_RUN)) {
    const inputs = explanationInputs(p);
    try {
      const result = await explainer(inputs);
      if (!result) continue;
      await db
        .insert(tennisExplanations)
        .values({ inputsHash: inputsHash(inputs), inputs, promptVersion: PROMPT_VERSION, ...result })
        .onConflictDoNothing();
      explained++;
      log("tennis explanation written", {
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    } catch (err) {
      log("tennis explanation failed", { error: err }, "WARNING");
    }
  }
  return { explained };
}
