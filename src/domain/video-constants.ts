// Shared by the database schema and the app (spec VID, §6.3).

export const VIDEO_SPORTS = ["tennis", "swimming", "soccer", "hockey", "other"] as const;
export type VideoSport = (typeof VIDEO_SPORTS)[number];

export const SPORT_LABEL: Record<VideoSport, string> = {
  tennis: "Tennis",
  swimming: "Swimming",
  soccer: "Soccer",
  hockey: "Hockey",
  other: "Other",
};

// Where a review's sport came from (intent 0005, SPT-4): chosen by the
// owner, being worked out by the job, worked out, or not worked out (the
// review then uses "other" until the owner sets it).
export const SPORT_SOURCES = ["chosen", "detecting", "detected", "unsure"] as const;
export type SportSource = (typeof SPORT_SOURCES)[number];

// How the history and the review page name a review's sport (SPT-4).
export function sportText(sport: VideoSport, source: SportSource) {
  if (source === "detecting" || source === "unsure") return "Sport not set";
  return source === "detected" ? `${SPORT_LABEL[sport]} (detected)` : SPORT_LABEL[sport];
}

// The form's "Detect automatically" choice (SPT-1).
export const AUTO_SPORT = "auto";

// drive and photos can be reviewed; youtube and other links are only kept
// in the history (F-3).
export const VIDEO_PROVIDERS = ["drive", "photos", "youtube", "other"] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

// picking: waiting for the owner to choose the video in Google Photos.
// saved: a link that can't be reviewed (YouTube), kept with its note.
export const VIDEO_STATUSES = ["queued", "picking", "analysing", "done", "failed", "saved"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

// One model call of a review: working out the sport (intent 0005, SPT-2),
// then the review itself.
// A follow-up question (intent 0026, ASK-7) and a spoken question turned
// into words (ASK-10) are rounds too, so the costs page counts them.
export const REVIEW_ROUNDS = ["detect", "review", "question", "transcribe"] as const;
export type ReviewRound = (typeof REVIEW_ROUNDS)[number];

// A follow-up question's life (intent 0026, ASK-3, ASK-5).
export const QUESTION_STATUSES = ["queued", "answering", "done", "failed"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
// ASK-6, intent question 1; ASK-1, question 2.
export const MAX_QUESTIONS = 10;
export const MAX_QUESTION_CHARS = 500;
