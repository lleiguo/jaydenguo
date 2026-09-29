import { ATTENDANCE, CATEGORIES } from "@/domain/constants";

type Rule = { match: string; category?: string; attendance?: string; owner?: string };
type Named = { id: string; name: string };

// Rules are edited as text, one per line: "swim = swimming",
// "(optional) = optional", "(Lei) = Lei" (whose event, by name).
export function rulesToText(rules: Rule[] | undefined, people: Named[] = []): string {
  const name = (id: string) => people.find((p) => p.id === id)?.name;
  return (rules ?? [])
    .flatMap((r) => [
      ...(r.category ? [`${r.match} = ${r.category}`] : []),
      ...(r.attendance ? [`${r.match} = ${r.attendance}`] : []),
      ...(r.owner && name(r.owner) ? [`${r.match} = ${name(r.owner)}`] : []),
    ])
    .join("\n");
}

export function textToRules(text: string, people: Named[] = []): { rules: Rule[]; errors: string[] } {
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
    const person = people.find((p) => p.name.toLowerCase() === target);
    if (i < 1 || !match) errors.push(`"${line}": write it as "text = category"`);
    else if ((CATEGORIES as readonly string[]).includes(target)) rules.push({ match, category: target });
    else if ((ATTENDANCE as readonly string[]).includes(target)) rules.push({ match, attendance: target });
    else if (person) rules.push({ match, owner: person.id });
    else errors.push(`"${line}": "${target}" isn't a category, attendance or person`);
  }
  return { rules, errors };
}
