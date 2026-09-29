import { ATTENDANCE, CATEGORIES, type Attendance, type Category } from "./constants";

// Per-source category mapping (ACT-1, O-6): a default category and
// default owners, plus rules matched against the event title, e.g. "swim" →
// swimming in the household calendar. Rules can also set attendance
// ("(optional)" → optional) or an owner ("(Lei)" → Lei's `people.id`).
export type CategoryMapping = {
  default: Category;
  // `people.id`s; none means the primary person.
  owners?: string[];
  rules?: { match: string; category?: Category; attendance?: Attendance; owner?: string }[];
};

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export function parseMapping(raw: unknown): CategoryMapping {
  const m = (raw ?? {}) as Partial<CategoryMapping>;
  const def = CATEGORIES.includes(m.default as Category) ? (m.default as Category) : "other";
  const rules = Array.isArray(m.rules)
    ? m.rules.filter(
        (r) =>
          typeof r?.match === "string" &&
          r.match.trim() &&
          (r.category === undefined || CATEGORIES.includes(r.category)) &&
          (r.attendance === undefined || ATTENDANCE.includes(r.attendance)) &&
          (r.owner === undefined || isId(r.owner)),
      )
    : [];
  const owners = Array.isArray(m.owners) ? m.owners.filter(isId) : [];
  return { default: def, owners, rules };
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

// Whose event: every matching rule's owner, else the source's default
// owners. Empty means the primary person.
export function ownersFor(title: string, mapping: CategoryMapping): string[] {
  const t = title.toLowerCase();
  const matched = (mapping.rules ?? [])
    .filter((r) => r.owner && t.includes(r.match.trim().toLowerCase()))
    .map((r) => r.owner!);
  return [...new Set(matched.length ? matched : (mapping.owners ?? []))];
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
  { match: "(optional)", attendance: "optional" },
];
