// People and whose events are whose (owner, 2026-09-28). An event's owners
// are `people.id`s; none means the primary person (Jayden), so events from
// before owners existed, and anything added without a choice, stay his.

export type Person = { id: string; name: string; isPrimary: boolean };

export function resolveOwners(
  stored: readonly string[] | null | undefined,
  people: readonly Person[],
): string[] {
  const known = new Set(people.map((p) => p.id));
  const ids = [...new Set(stored ?? [])].filter((id) => known.has(id));
  if (ids.length) return people.filter((p) => ids.includes(p.id)).map((p) => p.id);
  const primary = people.find((p) => p.isPrimary);
  return primary ? [primary.id] : [];
}

export const shareOwner = (a: readonly string[], b: readonly string[]) => a.some((id) => b.includes(id));
