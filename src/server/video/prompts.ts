import { z } from "zod";
import { VIDEO_SPORTS, type VideoSport } from "../../domain/video-constants";

// Prompts and answer schemas for the video review (spec VID-3, §6.3, plan
// M5.4-M5.5). Judges only ever see "Review A" and "Review B": no prompt a
// judge gets names a model (F-12, tested). Prompts are versioned; the
// version is stored with every call. v1 is frozen after the M5.7 evaluation.

export const PROMPT_VERSION = "video-1-draft";

// Framing for his development stage (VID-3). Not stored anywhere else.
export const athleteAge = () => Number(process.env.ATHLETE_AGE ?? 9);

export const RUBRIC: Record<VideoSport, string> = {
  tennis:
    "Tennis strokes: ready position and split step, grip, stance and footwork, unit turn and preparation, " +
    "contact point (in front, at a comfortable height), swing path and follow-through, balance and recovery. " +
    "Serve: stance, toss (height and placement), trophy position, racket drop, contact at full reach, follow-through.",
  swimming:
    "Swimming: body line and head position, catch and pull (high elbow), rotation, kick (from the hips, " +
    "small and steady), breathing timing, streamlines off walls, turns (approach, tuck, push-off) and finishes.",
  soccer:
    "Soccer: first touch, body shape when receiving, dribbling close control, passing technique (plant foot, " +
    "contact surface), shooting technique, scanning, and movement off the ball.",
  hockey:
    "Hockey: skating stride and knee bend, edges and crossovers, stops, puck handling with eyes up, " +
    "passing and receiving, shooting technique (weight transfer, follow-through).",
  other: "The sport's basic technique: posture, balance, timing, and the main movement shown.",
};

// --- Answer schemas -------------------------------------------------------

const at = z
  .string()
  .nullable()
  .describe('Time in the video as "m:ss" (e.g. "0:07"), or null if no single moment');

const point = z.object({
  text: z.string().min(1).describe("One point, in plain words a parent and a child can follow"),
  at,
  why: z.string().describe("What in the video shows this"),
});

export const reviewSchema = z.object({
  summary: z.string().describe("Two or three sentences: the overall picture"),
  good: z.array(point).min(1).max(5).describe("What's good"),
  fix: z.array(point).min(1).max(5).describe("What to fix, most impactful first"),
  drills: z
    .array(z.object({ name: z.string(), how: z.string(), reps: z.string() }))
    .min(1)
    .max(3),
  filmNext: z.string().describe("What to film next time, and from which angle"),
});
export type Review = z.infer<typeof reviewSchema>;

const score = z.number().int().min(1).max(5);
export const scoresSchema = z.object({
  grounded: score,
  correct: score,
  ageAppropriate: score,
  actionable: score,
  prioritised: score,
});
export type Scores = z.infer<typeof scoresSchema>;
export const CRITERIA = ["grounded", "correct", "ageAppropriate", "actionable", "prioritised"] as const;
export const CRITERION_LABEL: Record<(typeof CRITERIA)[number], string> = {
  grounded: "Grounded",
  correct: "Correct technique",
  ageAppropriate: "Age-appropriate",
  actionable: "Actionable",
  prioritised: "Prioritised",
};
export const total = (s: Scores) => CRITERIA.reduce((sum, c) => sum + s[c], 0);

const label = z.enum(["A", "B"]);

export const critiqueSchema = z.object({
  reviews: z
    .array(
      z.object({
        label,
        scores: scoresSchema,
        unsupported: z.array(z.string()).describe("Claims that can't be seen in the video at the cited time"),
        errors: z.array(z.object({ point: z.string(), reason: z.string() })).describe("Specific errors"),
        missed: z
          .array(z.string())
          .describe("Important points this review missed that the other one made or that the video shows"),
        comment: z.string().describe("One or two sentences overall"),
      }),
    )
    .length(2),
});
export type Critique = z.infer<typeof critiqueSchema>;

export const rebuttalSchema = z.object({
  replies: z.array(
    z.object({
      point: z.string().describe("The criticised point, quoted briefly"),
      response: z.enum(["concede", "defend"]),
      argument: z.string().describe("One or two sentences"),
      at,
    }),
  ),
});
export type Rebuttal = z.infer<typeof rebuttalSchema>;

export const finalScoreSchema = z.object({
  reviews: z.array(z.object({ label, scores: scoresSchema, reason: z.string() })).length(2),
});
export type FinalScore = z.infer<typeof finalScoreSchema>;

const combinedPoint = point.extend({
  status: z.enum(["agreed", "disputed"]),
  // For a disputed point: the case for it and against it.
  sides: z.object({ for: z.string(), against: z.string() }).nullable(),
});
export const combinedSchema = z.object({
  summary: z.string(),
  good: z.array(combinedPoint).max(6),
  fix: z.array(combinedPoint).max(6).describe("Most impactful first"),
  drills: z
    .array(z.object({ name: z.string(), how: z.string(), reps: z.string() }))
    .min(1)
    .max(3),
  filmNext: z.string(),
});
export type Combined = z.infer<typeof combinedSchema>;

// intent 0005, SPT-2: which sport the video shows, before the review.
export const detectSchema = z.object({
  sport: z.enum(VIDEO_SPORTS).describe('The sport shown, or "other" for any sport not listed'),
  sure: z.boolean().describe("True only if the video clearly shows this sport"),
  reason: z.string().describe("What in the video shows it, in one sentence"),
});
export type Detected = z.infer<typeof detectSchema>;

// --- Prompts ---------------------------------------------------------------

export type ReviewContext = { sport: VideoSport; note: string | null; input: "video" | "frames" };

const mediaLine = (input: ReviewContext["input"]) =>
  input === "video"
    ? "You have the video itself."
    : "You have still frames from the video, each labelled with its time. Frames are denser around the fastest motion. You can't see motion between frames, so don't claim what happens between them.";

function context(c: ReviewContext) {
  return [
    `Sport: ${c.sport}.`,
    c.note ? `The parent's note: "${c.note}"` : "The parent left no note.",
    `What to look at (${c.sport}): ${RUBRIC[c.sport]}`,
    mediaLine(c.input),
  ].join("\n");
}

export function detectSystem() {
  return `You identify which sport a short video of a young athlete shows. Answer only from what is visible: the court, pool, field or rink, the equipment and the movement. If it isn't clear, say you aren't sure.`;
}

export function detectPrompt(input: ReviewContext["input"]) {
  const sports = VIDEO_SPORTS.filter((s) => s !== "other").join(", ");
  return `${mediaLine(input)}

Which sport does this video show? The choices are: ${sports}, or "other" for any other sport.`;
}

export function reviewerSystem() {
  const age = athleteAge();
  return `You are an experienced youth coach reviewing a short video of a ${age}-year-old athlete for their parent.
Everything you say must be visible in the video. Cite the time ("m:ss") of each point where you can. If something can't be judged from this footage, say so instead of guessing.
Frame the advice for a ${age}-year-old's development stage: simple cues, fun drills, nothing meant for adult elite athletes, and nothing unsafe. Put the most impactful fix first. Keep each point short.
This is AI feedback to help a parent, not a coach's assessment.`;
}

export function reviewPrompt(c: ReviewContext) {
  return `${context(c)}

Write your review: what's good, what to fix (most impactful first), one to three drills for the next practice, and what to film next time.`;
}

export function judgeSystem() {
  const age = athleteAge();
  return `You are judging two written reviews of the same short video of a ${age}-year-old athlete. The reviews are labelled Review A and Review B; you don't know who wrote them. Judge only what is written against what the video shows.
Score each review from 1 (poor) to 5 (excellent) on:
- grounded: every claim is visible in the video at the cited time; list claims you can't see as unsupported;
- correct: the claims are sound technique for the sport;
- ageAppropriate: suitable for a ${age}-year-old's development stage; no adult-elite cues; nothing unsafe;
- actionable: the fixes and drills can be done at the next practice;
- prioritised: the most impactful fix comes first.
Be specific and fair. Length and style don't earn points; accuracy and usefulness do.`;
}

const asText = (r: Review) => JSON.stringify(r, null, 2);

export function critiquePrompt(c: ReviewContext, a: Review, b: Review) {
  return `${context(c)}

Review A:
${asText(a)}

Review B:
${asText(b)}

Critique and score both reviews. For each, list unsupported claims, specific errors, and important points it missed.`;
}

export function rebuttalSystem() {
  return `${reviewerSystem()}
Your review has been critiqued. Reply once to each criticism: concede it if it's right, or defend the point, briefly, citing the time in the video.`;
}

export function rebuttalPrompt(c: ReviewContext, own: Review, critiques: Critique["reviews"]) {
  const lines = critiques.map(
    (k, i) =>
      `Critique ${i + 1}:\n${JSON.stringify({ unsupported: k.unsupported, errors: k.errors, missed: k.missed, comment: k.comment }, null, 2)}`,
  );
  return `${context(c)}

Your review:
${asText(own)}

${lines.join("\n\n")}

Reply to the criticisms of your review.`;
}

export function finalScorePrompt(
  c: ReviewContext,
  a: Review,
  b: Review,
  rebuttals: { A: Rebuttal; B: Rebuttal },
) {
  return `${context(c)}

Review A:
${asText(a)}

Review A's author replied to the critiques:
${JSON.stringify(rebuttals.A, null, 2)}

Review B:
${asText(b)}

Review B's author replied to the critiques:
${JSON.stringify(rebuttals.B, null, 2)}

With the replies in view, give your final scores for both reviews. A conceded point counts against the review; a well-defended one doesn't.`;
}

export function combineSystem() {
  return `${reviewerSystem()}
You are writing the final advice from two reviews of the same video, their critiques and their authors' replies.
Keep points both sides accept ("agreed"). Drop points their author conceded. Keep points still argued over as "disputed", with the case for and against each in one sentence. Put the most impactful fix first.`;
}

export function combinePrompt(
  c: ReviewContext,
  a: Review,
  b: Review,
  critiques: Critique["reviews"][],
  rebuttals: { A: Rebuttal; B: Rebuttal },
) {
  return `${context(c)}

Review A:
${asText(a)}

Review B:
${asText(b)}

Critiques (both judges, of both reviews):
${JSON.stringify(critiques, null, 2)}

Replies from Review A's author:
${JSON.stringify(rebuttals.A, null, 2)}

Replies from Review B's author:
${JSON.stringify(rebuttals.B, null, 2)}

Write the combined review.`;
}
