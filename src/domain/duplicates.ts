import type { Category } from "./constants";
import { shareOwner } from "./people";

// Household duplicates (owner, 2026-09-28): the family calendar often
// repeats an event a dedicated source already has, e.g. "Jayden soccer" next
// to the TeamSnap game. The dedicated source is the truth, so the household
// copy is left out of the calendar, its clashes and the Google copy.
//
// It also repeats itself (owner, 2026-10-01): a repeating practice plus a
// one-off entry for the same evening. Those show once.
//
// Coach emails repeat themselves too (intent 0013): a booking, a payment
// reminder and a reschedule each became an event for one lesson. Email
// events give way to a feed's, and of two the later one stays.

// Source kinds whose events give way to any other source's.
export const HOUSEHOLD_KINDS = ["google_calendar"];
// Source kinds whose events are approved email suggestions (0001 EML-3).
export const EMAIL_KINDS = ["gmail"];

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
  // When it was added: the later of two email events stays (DUP-6).
  createdAt: Date;
};

type Slot = Pick<DedupEvent, "start" | "end" | "allDay">;

// Do the two happen at the same time?
function sameTime(a: Slot, b: Slot): boolean {
  if (a.allDay !== b.allDay) return false;
  const overlap = Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime());
  if (a.allDay) return overlap > 0;
  // Timed: they overlap by at least half the shorter one, so a household
  // "5-6:30" matches a team's 5:15 kick-off but not a later practice.
  const shorter = Math.min(a.end.getTime() - a.start.getTime(), b.end.getTime() - b.start.getTime());
  return overlap > 0 && overlap * 2 >= shorter;
}

// Do the two happen at the same time, for the same person?
function sameSlot(a: DedupEvent, b: DedupEvent): boolean {
  return shareOwner(a.owners, b.owners) && sameTime(a, b);
}

// The same activity at the same time, whoever it's for: an email
// suggestion has no owners until it's approved (0013 DUP-3).
export function looksAlike(a: Slot & { category: string }, b: Slot & { category: string }): boolean {
  return a.category === b.category && a.category !== "other" && sameTime(a, b);
}

// Are `a` and `b` the same event, for the same person, from what they are
// rather than their titles? Also how a household twin is linked to a feed's
// event (0020 DUP2-2).
export function sameEvent(a: DedupEvent, b: DedupEvent): boolean {
  return looksAlike(a, b) && shareOwner(a.owners, b.owners);
}

const titleKey = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();

// Are two household events the same entry made twice? The title has to
// match, so two different things at the same time both still show.
function twins(a: DedupEvent, b: DedupEvent): boolean {
  return titleKey(a.title) === titleKey(b.title) && sameSlot(a, b);
}

// IDs of events to hide: household events that repeat another source's
// event or an earlier household event (PR #43, #64), and email events that
// repeat a feed's event or a later email event (DUP-5, DUP-6).
export function hiddenDuplicates(events: DedupEvent[]): Set<string> {
  const of = (kinds: string[]) => events.filter((e) => e.sourceKind && kinds.includes(e.sourceKind));
  const household = of(HOUSEHOLD_KINDS);
  const email = of(EMAIL_KINDS);
  const sourced = events.filter((e) => e.sourceKind && !HOUSEHOLD_KINDS.includes(e.sourceKind));
  const feeds = sourced.filter((e) => !EMAIL_KINDS.includes(e.sourceKind!));
  const out = new Set<string>();

  // DUP-5, DUP-6: newest first, so a reschedule beats the booking.
  const keptEmail: DedupEvent[] = [];
  for (const m of [...email].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    if (feeds.some((f) => sameEvent(m, f)) || keptEmail.some((k) => sameEvent(m, k))) out.add(m.id);
    else keptEmail.push(m);
  }

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
