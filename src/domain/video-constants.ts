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

export const REVIEW_MODELS = ["gemini", "claude"] as const;
export type ReviewModel = (typeof REVIEW_MODELS)[number];

export const MODEL_LABEL: Record<ReviewModel, string> = { gemini: "Gemini", claude: "Claude" };

// debate (VID-3a..c) or one model's review only (VID-3e).
export const REVIEW_MODES = ["debate", "gemini", "claude"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

// detect: the job working out the sport (intent 0005, SPT-2).
export const REVIEW_ROUNDS = ["detect", "review", "critique", "rebuttal", "final_score", "combine"] as const;
export type ReviewRound = (typeof REVIEW_ROUNDS)[number];

export const other = (m: ReviewModel): ReviewModel => (m === "gemini" ? "claude" : "gemini");
