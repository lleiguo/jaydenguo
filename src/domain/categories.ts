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

// Whose event (owner, 2026-09-29): every matching rule's owner plus anyone
// named in the title as a whole word ("Jayden swimming", "Lei's dentist").
// Else (intent 0024) "family" or "everyone" in the title is everyone's
// (OWN-5), then whoever made it (OWN-2), then the source's default owners
// (OWN-3). Empty means the primary person.
export function ownersFor(
  title: string,
  mapping: CategoryMapping,
  people: readonly { id: string; name: string }[] = [],
  creatorId?: string | null,
): string[] {
  const t = title.toLowerCase();
  const byRule = (mapping.rules ?? [])
    .filter((r) => r.owner && t.includes(r.match.trim().toLowerCase()))
    .map((r) => r.owner!);
  const byName = people.filter((p) => namedIn(title, p.name)).map((p) => p.id);
  const matched = [...byRule, ...byName];
  if (matched.length) return [...new Set(matched)];
  if (people.length && EVERYONE_WORDS.some((w) => namedIn(title, w))) return people.map((p) => p.id);
  if (creatorId && people.some((p) => p.id === creatorId)) return [creatorId];
  return [...new Set(mapping.owners ?? [])];
}

const EVERYONE_WORDS = ["family", "everyone", "everybody"];

// OWN-2, OWN-4: the person with this Google email, if any.
export function personWithEmail(
  email: string | null | undefined,
  people: readonly { id: string; emails: readonly string[] }[],
): string | null {
  const e = email?.trim().toLowerCase();
  if (!e) return null;
  return people.find((p) => p.emails.includes(e))?.id ?? null;
}

export const namedIn = (title: string, name: string) => {
  const n = name.trim();
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(title);
};

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
