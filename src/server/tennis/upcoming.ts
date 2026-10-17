import { ACTIVE_ENTRY } from "../../domain/tennis-entry";
import type { EntryStatus } from "../../domain/tennis-constants";
import type { EntryView } from "./entries";
import type { DrawView, TournamentView } from "./load";

// TEN-2 with TEN-10 (owner, 2026-09-28): "Upcoming tournaments" lists every
// tournament he's registered for, including ones whose draw and acceptance
// list aren't out yet (known only from tennis_entries), with where his
// entry stands and, once the draw is out, his next opponent.

export type UpcomingStatus =
  | { kind: "registered"; label: string; action: { text: string; url: string } | null }
  | { kind: "main_draw" | "reserve" | "withdrawn"; label: string; action: null };

export type UpcomingRow = {
  key: string;
  name: string;
  // The tournament's page here once it's synced, else the site's page.
  tournamentId: string | null;
  // His entry, for its acceptance list (intent 0017, ACC-5).
  entryId: string | null;
  url: string | null;
  startDate: string;
  endDate: string;
  venue: string | null;
  driveMinutes: number | null;
  events: string[];
  status: UpcomingStatus;
  // His draws that are out (active only).
  draws: DrawView[];
};

const entryKey = (sourceId: string | null, externalId: string | null) =>
  sourceId && externalId ? `${sourceId}|${externalId}` : null;

// Intent 0017, ACC-1: in the main draw is "Accepted".
const ACCEPTED: UpcomingStatus = { kind: "main_draw", label: "Accepted", action: null };

export function entryStatus(e: Pick<EntryView, "status" | "reservePosition" | "entryUrl">): UpcomingStatus {
  switch (e.status as EntryStatus) {
    case "main_draw":
      return ACCEPTED;
    case "reserve":
      return {
        kind: "reserve",
        label: `Reserve list${e.reservePosition ? ` (${e.reservePosition})` : ""}`,
        action: null,
      };
    case "payment_needed":
      return {
        kind: "registered",
        label: "Payment required",
        action: e.entryUrl ? { text: "Pay on the site", url: e.entryUrl } : null,
      };
    default:
      return { kind: "registered", label: "Registered", action: null };
  }
}

export function upcomingRows(
  tournaments: TournamentView[],
  entries: EntryView[],
  today: string,
): UpcomingRow[] {
  const active = entries.filter((e) => ACTIVE_ENTRY.includes(e.status as EntryStatus));
  const byKey = new Map<string, EntryView[]>();
  for (const e of active) {
    const k = entryKey(e.sourceId, e.tournamentExternalId)!;
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const claimed = new Set<string>();
  const rows: UpcomingRow[] = [];

  for (const t of tournaments) {
    if (t.when === "past") continue;
    const k = entryKey(t.sourceId, t.externalId);
    const mine = (k && byKey.get(k)) || [];
    if (k && mine.length) claimed.add(k);
    // In progress: the "In progress" section has it already.
    if (t.when !== "upcoming") continue;
    const draws = t.draws.filter((d) => d.status === "active");
    const withdrawn = t.draws.length > 0 && !draws.length;
    const status: UpcomingStatus = draws.length
      ? ACCEPTED
      : withdrawn
        ? { kind: "withdrawn", label: "Withdrawn", action: null }
        : mine.length
          ? entryStatus(mine[0])
          : { kind: "registered", label: "Registered", action: null };
    rows.push({
      key: t.id,
      name: t.name,
      tournamentId: t.id,
      entryId: mine[0]?.id ?? null,
      url: t.sourceUrl,
      startDate: t.startDate,
      endDate: t.endDate,
      venue: [t.venue, t.city].filter(Boolean).join(", ") || null,
      driveMinutes: mine.find((e) => e.driveMinutes !== null)?.driveMinutes ?? null,
      events: t.events.length ? t.events : mine.map((e) => e.eventName),
      status,
      draws,
    });
  }

  // Entered, but the sync hasn't picked the tournament up yet.
  for (const [k, mine] of byKey) {
    if (claimed.has(k)) continue;
    const e = mine[0];
    if (e.endDate < today) continue;
    rows.push({
      key: e.id,
      name: e.tournamentName,
      tournamentId: null,
      entryId: e.id,
      url: e.tournamentUrl,
      startDate: e.startDate,
      endDate: e.endDate,
      venue: [e.venue, e.city].filter(Boolean).join(", ") || null,
      driveMinutes: e.driveMinutes,
      events: mine.map((x) => x.eventName),
      status: entryStatus(e),
      draws: [],
    });
  }
  return rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
}
