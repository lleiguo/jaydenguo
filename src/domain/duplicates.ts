import type { Category } from "./constants";
import { shareOwner } from "./people";

// Household duplicates (owner, 2026-09-28): the family calendar often
// repeats an event a dedicated source already has, e.g. "Jayden soccer" next
// to the TeamSnap game. The dedicated source is the truth, so the household
// copy is left out of the calendar, its clashes and the Google copy.
//
// It also repeats itself (owner, 2026-10-01): a repeating practice plus a
// one-off entry for the same evening. Those show once.

// Source kinds whose events give way to any other source's.
export const HOUSEHOLD_KINDS = ["google_calendar"];

export type DedupEvent = {
  id: string;
  // Null for events added on this site; those are never suppressed and
  // never suppress anything.
  sourceKind: string | null;
  title: string;
  category: Category;
  // Resolved owners; a household event only gives way to one of the same
  // person's.
  owners: string[];
  // Effective times, after any override.
  start: Date;
  end: Date;
  allDay: boolean;
  // One occurrence of a repeating event.
  repeats: boolean;
};

// Do the two happen at the same time, for the same person?
function sameSlot(a: DedupEvent, b: DedupEvent): boolean {
  if (a.allDay !== b.allDay) return false;
  if (!shareOwner(a.owners, b.owners)) return false;
  const overlap = Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime());
  if (a.allDay) return overlap > 0;
  // Timed: they overlap by at least half the shorter one, so a household
  // "5-6:30" matches a team's 5:15 kick-off but not a later practice.
  const shorter = Math.min(a.end.getTime() - a.start.getTime(), b.end.getTime() - b.start.getTime());
  return overlap > 0 && overlap * 2 >= shorter;
}

// Is `h` (household) the same event as `s` (source)?
function sameEvent(h: DedupEvent, s: DedupEvent): boolean {
  return h.category === s.category && h.category !== "other" && sameSlot(h, s);
}

const titleKey = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();

// Are two household events the same entry made twice? The title has to
// match, so two different things at the same time both still show.
function twins(a: DedupEvent, b: DedupEvent): boolean {
  return titleKey(a.title) === titleKey(b.title) && sameSlot(a, b);
}

// IDs of household events that duplicate an event from another source, or
// an earlier household event.
export function householdDuplicates(events: DedupEvent[]): Set<string> {
  const household = events.filter((e) => e.sourceKind && HOUSEHOLD_KINDS.includes(e.sourceKind));
  const sourced = events.filter((e) => e.sourceKind && !HOUSEHOLD_KINDS.includes(e.sourceKind));
  const out = new Set<string>();
  for (const h of household) if (sourced.some((s) => sameEvent(h, s))) out.add(h.id);
  // Of two twins the one-off stays: it was written for that day, where the
  // repeat is the general rule. Otherwise the first one stays.
  const kept: DedupEvent[] = [];
  for (const h of [...household].sort((a, b) => Number(a.repeats) - Number(b.repeats))) {
    if (out.has(h.id)) continue;
    if (kept.some((k) => twins(h, k))) out.add(h.id);
    else kept.push(h);
  }
  return out;
}
