import { ATTENDANCE, CATEGORIES } from "@/domain/constants";

type Rule = { match: string; category?: string; attendance?: string };

// Rules are edited as text, one per line: "swim = swimming",
// "(parent) = parent_only".
export function rulesToText(rules: Rule[] | undefined): string {
  return (rules ?? []).map((r) => `${r.match} = ${r.category ?? r.attendance}`).join("\n");
}

export function textToRules(text: string): { rules: Rule[]; errors: string[] } {
  const rules: Rule[] = [];
  const errors: string[] = [];
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const i = line.lastIndexOf("=");
    const match = line.slice(0, i).trim();
    const target = line
      .slice(i + 1)
      .trim()
      .toLowerCase();
    if (i < 1 || !match) errors.push(`"${line}": write it as "text = category"`);
    else if ((CATEGORIES as readonly string[]).includes(target)) rules.push({ match, category: target });
    else if ((ATTENDANCE as readonly string[]).includes(target)) rules.push({ match, attendance: target });
    else errors.push(`"${line}": unknown category "${target}"`);
  }
  return { rules, errors };
}
