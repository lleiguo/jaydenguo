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

export const REVIEW_ROUNDS = ["review", "critique", "rebuttal", "final_score", "combine"] as const;
export type ReviewRound = (typeof REVIEW_ROUNDS)[number];

export const other = (m: ReviewModel): ReviewModel => (m === "gemini" ? "claude" : "gemini");
