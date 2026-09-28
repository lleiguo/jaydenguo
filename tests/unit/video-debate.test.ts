import { describe, expect, it } from "vitest";
import { decide, runDebate, type RoundRecord } from "@/server/video/debate";
import { fakeModels, marker } from "@/server/video/fake";
import { combinedSchema, reviewSchema } from "@/server/video/prompts";

const input = {
  context: { sport: "tennis" as const, note: "forehand, focus on the finish" },
  media: {
    gemini: { kind: "video" as const, data: Buffer.from("v"), mimeType: "video/mp4", fps: 8 },
    claude: { kind: "frames" as const, frames: [{ atSec: 1, jpeg: Buffer.from("f") }] },
  },
};

// A fixed sequence standing in for Math.random.
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("runDebate", () => {
  it("runs five rounds and picks the higher average of both judges' final totals", async () => {
    const models = fakeModels({
      critique: { gemini: { gemini: 4, claude: 3 }, claude: { gemini: 3, claude: 4 } },
      final: { gemini: { gemini: 5, claude: 3 }, claude: { gemini: 4, claude: 4 } },
    });
    const rounds: RoundRecord[] = [];
    const result = await runDebate("debate", models, input, {
      saveRound: (r) => void rounds.push(r),
      random: seq(0.2, 0.8),
    });
    expect(rounds.map((r) => `${r.round}:${r.model}`).sort()).toEqual(
      [
        "review:gemini",
        "review:claude",
        "critique:gemini",
        "critique:claude",
        "rebuttal:gemini",
        "rebuttal:claude",
        "final_score:gemini",
        "final_score:claude",
        "combine:gemini",
      ].sort(),
    );
    // Gemini's review: (25 + 20) / 2 = 22.5; Claude's: (15 + 20) / 2 = 17.5.
    expect(result.verdict).toMatchObject({
      winner: "gemini",
      tie: false,
      margin: 5,
      totals: { gemini: 22.5, claude: 17.5 },
    });
    // Self-preference: Gemini gave its own review 25, Claude gave it 20.
    expect(result.verdict!.selfScores.gemini).toEqual({ own: 25, other: 20, preference: 5 });
    expect(result.verdict!.selfScores.claude).toEqual({ own: 20, other: 15, preference: 5 });
    expect(combinedSchema.safeParse(result.combined).success).toBe(true);
  });

  it("maps blind labels back to the right model whichever order a judge saw", async () => {
    for (const r of [0.1, 0.9]) {
      const models = fakeModels({
        critique: { gemini: { gemini: 2, claude: 5 }, claude: { gemini: 2, claude: 5 } },
      });
      const rounds: RoundRecord[] = [];
      const result = await runDebate("debate", models, input, {
        saveRound: (x) => void rounds.push(x),
        random: () => r,
      });
      expect(result.verdict!.winner).toBe("claude");
      const critique = rounds.find((x) => x.round === "critique" && x.model === "gemini")!;
      expect(critique.labels).toEqual(r < 0.5 ? { A: "gemini", B: "claude" } : { A: "claude", B: "gemini" });
      expect(critique.scores!.claude!.total).toBe(25);
      expect(critique.scores!.gemini!.total).toBe(10);
      // Claude won, so Claude writes the combined review.
      expect(rounds.find((x) => x.round === "combine")!.model).toBe("claude");
    }
  });

  it("never names a model in what the judges, authors or combiner are told", async () => {
    const models = fakeModels();
    await runDebate("debate", models, input, { random: seq(0.3, 0.7, 0.1) });
    for (const m of [models.gemini, models.claude]) {
      for (const req of m.requests.filter((r) => r.purpose !== "review")) {
        const text = `${req.system}\n${req.prompt}`
          // The fake reviews' markers are test scaffolding, not model names.
          .replaceAll(marker("gemini"), "")
          .replaceAll(marker("claude"), "");
        expect(text).not.toMatch(/gemini|claude|google|anthropic/i);
      }
    }
  });

  it("gives each judge the same media it had for its review", async () => {
    const models = fakeModels();
    await runDebate("debate", models, input);
    expect(models.gemini.requests.every((r) => r.media?.kind === "video")).toBe(true);
    expect(models.claude.requests.every((r) => r.media?.kind === "frames")).toBe(true);
  });

  it("drops conceded points from the combined review", async () => {
    const result = await runDebate("debate", fakeModels({ concede: true }), input);
    const texts = (result.combined as { fix: { text: string }[] }).fix.map((f) => f.text);
    expect(texts).toEqual(["Turn the shoulders sooner"]);
  });

  it("keeps a defended point as disputed", async () => {
    const result = await runDebate("debate", fakeModels({ concede: false }), input);
    const fix = (result.combined as { fix: { text: string; status: string }[] }).fix;
    expect(fix.find((f) => f.text === "Finish over the shoulder")?.status).toBe("disputed");
  });

  it("tells each author only the critiques of its own review", async () => {
    const models = fakeModels();
    await runDebate("debate", models, input);
    const rebuttal = models.gemini.requests.find((r) => r.purpose === "rebuttal")!;
    expect(rebuttal.prompt).toContain(marker("gemini"));
    expect(rebuttal.prompt).not.toContain(marker("claude"));
  });

  it("runs one review in single-model mode", async () => {
    const models = fakeModels();
    const result = await runDebate("gemini", models, input);
    expect(models.claude.requests).toHaveLength(0);
    expect(models.gemini.requests.map((r) => r.purpose)).toEqual(["review"]);
    expect(result.verdict).toBeNull();
    expect(reviewSchema.safeParse(result.combined).success).toBe(true);
  });
});

describe("decide", () => {
  it("calls a tie within 1 point of the averages", () => {
    const v = decide({ gemini: { gemini: 21, claude: 20 }, claude: { gemini: 19, claude: 21 } });
    expect(v.totals).toEqual({ gemini: 20, claude: 20.5 });
    expect(v).toMatchObject({ winner: "claude", tie: true, margin: 0.5 });
  });

  it("isn't a tie beyond 1 point", () => {
    const v = decide({ gemini: { gemini: 22, claude: 18 }, claude: { gemini: 21, claude: 19 } });
    expect(v).toMatchObject({ winner: "gemini", tie: false, margin: 3 });
  });

  it("lets Gemini write when the averages are equal", () => {
    expect(decide({ gemini: { gemini: 20, claude: 20 }, claude: { gemini: 20, claude: 20 } })).toMatchObject({
      winner: "gemini",
      tie: true,
      margin: 0,
    });
  });
});
