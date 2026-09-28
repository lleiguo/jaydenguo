import { ATTENDANCE, CATEGORIES, type Attendance, type Category } from "./constants";

// Per-source category mapping (ACT-1, O-6): a default category, plus rules
// matched against the event title, e.g. "swim" → swimming in the household
// calendar. Rules can also set attendance ("(parent)" → parent_only).
export type CategoryMapping = {
  default: Category;
  rules?: { match: string; category?: Category; attendance?: Attendance }[];
};

export function parseMapping(raw: unknown): CategoryMapping {
  const m = (raw ?? {}) as Partial<CategoryMapping>;
  const def = CATEGORIES.includes(m.default as Category) ? (m.default as Category) : "other";
  const rules = Array.isArray(m.rules)
    ? m.rules.filter(
        (r) =>
          typeof r?.match === "string" &&
          r.match.trim() &&
          (r.category === undefined || CATEGORIES.includes(r.category)) &&
          (r.attendance === undefined || ATTENDANCE.includes(r.attendance)),
      )
    : [];
  return { default: def, rules };
}

export function categorise(
  title: string,
  mapping: CategoryMapping,
): { category: Category; attendance: Attendance } {
  const t = title.toLowerCase();
  let category: Category | undefined;
  let attendance: Attendance | undefined;
  for (const rule of mapping.rules ?? []) {
    if (!t.includes(rule.match.trim().toLowerCase())) continue;
    category ??= rule.category;
    attendance ??= rule.attendance;
  }
  return { category: category ?? mapping.default, attendance: attendance ?? "required" };
}

// Suggested rules for a school's key dates page (SCH-2): closures become
// banners (CAL-7); everything else is a school event.
export const SCHOOL_DATE_RULES: CategoryMapping["rules"] = [
  { match: "school closed", category: "school_closure" },
  { match: "no classes", category: "school_closure" },
  { match: "non-instructional", category: "school_closure" },
  { match: "pro-d", category: "school_closure" },
];

// Suggested rules for a household calendar (spec §12 q4: classes live there).
export const HOUSEHOLD_RULES: CategoryMapping["rules"] = [
  { match: "tennis", category: "tennis" },
  { match: "swim", category: "swimming" },
  { match: "soccer", category: "soccer" },
  { match: "hockey", category: "hockey" },
  { match: "math", category: "math" },
  { match: "chinese", category: "chinese" },
  { match: "fitness", category: "fitness" },
  { match: "(parent)", attendance: "parent_only" },
  { match: "(optional)", attendance: "optional" },
];
