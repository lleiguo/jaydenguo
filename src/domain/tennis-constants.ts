// Tennis constants shared by the schema, domain logic and client components.

// played: a result with a score; walkover: won without playing; retired:
// stopped part-way; scheduled: not played yet.
export const MATCH_OUTCOMES = ["played", "walkover", "retired", "scheduled"] as const;
export type MatchOutcome = (typeof MATCH_OUTCOMES)[number];
