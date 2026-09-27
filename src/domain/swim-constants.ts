// Swimming constants (SWM). Plain values so client components and the
// database schema can share them.
export const COURSES = ["SCM", "LCM", "SCY"] as const;
export type Course = (typeof COURSES)[number];

export const STROKES = ["free", "back", "breast", "fly", "im"] as const;
export type Stroke = (typeof STROKES)[number];

export const STROKE_LABEL: Record<Stroke, string> = {
  free: "Free",
  back: "Back",
  breast: "Breast",
  fly: "Fly",
  im: "IM",
};

export const COURSE_LABEL: Record<Course, string> = {
  SCM: "Short course metres",
  LCM: "Long course metres",
  SCY: "Short course yards",
};

export const DISTANCES = [25, 50, 100, 200, 400, 500, 800, 1000, 1500, 1650] as const;
