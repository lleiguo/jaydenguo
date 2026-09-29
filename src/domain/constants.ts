// Event categories and attendance (spec CAL-1, CON-1). Plain constants so
// client components can use them without the database schema.
export const CATEGORIES = [
  "tennis",
  "swimming",
  "soccer",
  "hockey",
  "math",
  "chinese",
  "fitness",
  "school_class",
  "school_closure",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Whose event it is lives in its owners (people), not here.
export const ATTENDANCE = ["required", "optional"] as const;
export type Attendance = (typeof ATTENDANCE)[number];
