// Tennis constants shared by the schema, domain logic and client components.

// played: a result with a score; walkover: won without playing; retired:
// stopped part-way; scheduled: not played yet.
export const MATCH_OUTCOMES = ["played", "walkover", "retired", "scheduled"] as const;
export type MatchOutcome = (typeof MATCH_OUTCOMES)[number];

// Tournament entries (TEN-9..11). found: an event he could enter that the
// app hasn't entered him in (the owner registers with the link); entered:
// the entry is in, waiting for the acceptance list; payment_needed: the
// entry is started but the owner has to pay on the site; main_draw and
// reserve: from the acceptance list; withdrawn: listed before, gone now;
// skipped: not entered because another tournament that weekend was
// chosen.
export const ENTRY_STATUSES = [
  "found",
  "entered",
  "payment_needed",
  "main_draw",
  "reserve",
  "withdrawn",
  "skipped",
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
