import type { Category } from "./constants";
import { shareOwner } from "./people";

// Household duplicates (owner, 2026-09-28): the family calendar often
// repeats an event a dedicated source already has, e.g. "Jayden soccer" next
// to the TeamSnap game. The dedicated source is the truth, so the household
// copy is left out of the calendar, its clashes and the Google copy.

// Source kinds whose events give way to any other source's.
export const HOUSEHOLD_KINDS = ["google_calendar"];

export type DedupEvent = {
  id: string;
  // Null for events added on this site; those are never suppressed and
  // never suppress anything.
  sourceKind: string | null;
  category: Category;
  // Resolved owners; a household event only gives way to one of the same
  // person's.
  owners: string[];
  // Effective times, after any override.
  start: Date;
  end: Date;
  allDay: boolean;
};

// Is `h` (household) the same event as `s` (source)?
function sameEvent(h: DedupEvent, s: DedupEvent): boolean {
  if (h.category !== s.category || h.category === "other" || h.allDay !== s.allDay) return false;
  if (!shareOwner(h.owners, s.owners)) return false;
  const overlap = Math.min(h.end.getTime(), s.end.getTime()) - Math.max(h.start.getTime(), s.start.getTime());
  if (h.allDay) return overlap > 0;
  // Timed: they overlap by at least half the shorter one, so a household
  // "5-6:30" matches a team's 5:15 kick-off but not a later practice.
  const shorter = Math.min(h.end.getTime() - h.start.getTime(), s.end.getTime() - s.start.getTime());
  return overlap > 0 && overlap * 2 >= shorter;
}

// IDs of household events that duplicate an event from another source.
export function householdDuplicates(events: DedupEvent[]): Set<string> {
  const household = events.filter((e) => e.sourceKind && HOUSEHOLD_KINDS.includes(e.sourceKind));
  const sourced = events.filter((e) => e.sourceKind && !HOUSEHOLD_KINDS.includes(e.sourceKind));
  const out = new Set<string>();
  for (const h of household) if (sourced.some((s) => sameEvent(h, s))) out.add(h.id);
  return out;
}
