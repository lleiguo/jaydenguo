import type { EntryStatus } from "./tennis-constants";

// Rules for the tournament-entry jobs (TEN-9..11), as pure functions: which
// event of a tournament fits him, whether a tournament is close enough,
// which of several same-weekend tournaments to enter, and where he stands
// on an entry list.

export type EntryPrefs = {
  // The event name must contain one of these words (any case)...
  include: string[];
  // ...and none of these.
  exclude: string[];
  // Between several fitting events, one containing these wins (e.g. "U9"
  // when a tournament has both U9 and U10 orange events).
  prefer: string[];
  maxDriveMinutes: number;
};

export const DEFAULT_ENTRY_PREFS: EntryPrefs = {
  include: ["orange"],
  // Not "mixed": "double" covers mixed doubles, and a U9 singles event for
  // boys and girls together is called e.g. "U9 Mixed - Orange".
  exclude: ["girl", "women", "double"],
  prefer: ["u9"],
  maxDriveMinutes: 120,
};

const words = (v: unknown, fallback: string[]) =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .map((x) => x.trim().toLowerCase())
    : typeof v === "string"
      ? v
          .split(",")
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean)
      : fallback;

// From the source's `config.entry` (Sources page); anything missing falls
// back to the defaults.
export function entryPrefsOf(config: unknown): EntryPrefs {
  const c = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const minutes = Number(c.maxDriveMinutes);
  return {
    include: words(c.include, DEFAULT_ENTRY_PREFS.include),
    exclude: words(c.exclude, DEFAULT_ENTRY_PREFS.exclude),
    prefer: words(c.prefer, DEFAULT_ENTRY_PREFS.prefer),
    maxDriveMinutes:
      Number.isFinite(minutes) && minutes >= 15 && minutes <= 600
        ? minutes
        : DEFAULT_ENTRY_PREFS.maxDriveMinutes,
  };
}

// A word starting in the name: "u9" doesn't match "U19", and "double"
// matches "Doubles".
function has(name: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}`, "i").test(name);
}

// The one event to enter him in, or null when none fits.
export function pickEvent<E extends { name: string }>(events: E[], prefs: EntryPrefs): E | null {
  const fits = events.filter(
    (e) => prefs.include.some((w) => has(e.name, w)) && !prefs.exclude.some((w) => has(e.name, w)),
  );
  if (!fits.length) return null;
  return fits.find((e) => prefs.prefer.some((w) => has(e.name, w))) ?? fits[0];
}

// The site's search radius options (km, straight line). The search asks
// for the smallest radius that still holds everything a drive of this
// length could reach (~100 km/h as the crow flies is generous), so the
// drive-time check afterwards decides.
const RADII = [25, 50, 75, 100, 200, 500];
export function searchRadiusKm(maxDriveMinutes: number): number {
  const reach = (maxDriveMinutes / 60) * 100;
  return RADII.find((r) => r >= reach) ?? RADII[RADII.length - 1];
}

// Without a drive time (no routing service), the radius has to do the
// limiting on its own: about 1 km of straight line per minute of driving,
// rounded down to the site's options, so it errs on the near side.
export function fallbackRadiusKm(maxDriveMinutes: number): number {
  return [...RADII].reverse().find((r) => r <= maxDriveMinutes) ?? RADII[0];
}

// Names compared loosely: case, accents, punctuation and word order ("Guo,
// Jayden" is "Jayden Guo") don't matter.
export const nameTokens = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");

export type EntryRow = {
  status: { kind: "main_draw" } | { kind: "reserve"; position: number | null } | null;
  tournamentPlayerIds: string[];
  names: string[];
};

// His row on an entry list: by tournament player number when known, else by
// name (singles rows only).
export function findSelfRow<R extends EntryRow>(
  rows: R[],
  self: { name: string; tournamentPlayerId?: string | null },
): R | null {
  if (self.tournamentPlayerId) {
    const byId = rows.find((r) => r.tournamentPlayerIds.includes(self.tournamentPlayerId!));
    if (byId) return byId;
  }
  const key = nameTokens(self.name);
  const byName = rows.filter((r) => r.names.length === 1 && nameTokens(r.names[0]) === key);
  return byName.length === 1 ? byName[0] : null;
}

// Where an entry stands after reading the list. Not on the list: an entry
// the owner hasn't made stays as it was; one that was on it is withdrawn;
// one just entered stays "entered" (the list may not be out yet).
export function statusFromList(
  current: EntryStatus,
  row: EntryRow | null,
): { status: EntryStatus; reservePosition: number | null } {
  if (row?.status?.kind === "main_draw") return { status: "main_draw", reservePosition: null };
  if (row?.status?.kind === "reserve") return { status: "reserve", reservePosition: row.status.position };
  if (row)
    return {
      status: current === "found" || current === "skipped" ? "entered" : current,
      reservePosition: null,
    };
  if (current === "main_draw" || current === "reserve") return { status: "withdrawn", reservePosition: null };
  return { status: current, reservePosition: null };
}

const overlaps = (a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) =>
  a.startDate <= b.endDate && b.startDate <= a.endDate;

export type Candidate = {
  tournamentId: string;
  startDate: string;
  endDate: string;
  driveMinutes: number | null;
};

// Which candidates to enter: never two tournaments on overlapping dates,
// and never one that overlaps a tournament he's already in. Closest first;
// an unknown drive time goes last.
export function chooseEntries<C extends Candidate>(
  candidates: C[],
  committed: { startDate: string; endDate: string }[],
): { enter: C[]; skip: { candidate: C; because: C | null }[] } {
  const order = [...candidates].sort(
    (a, b) =>
      (a.driveMinutes ?? Infinity) - (b.driveMinutes ?? Infinity) ||
      a.startDate.localeCompare(b.startDate) ||
      a.tournamentId.localeCompare(b.tournamentId),
  );
  const enter: C[] = [];
  const skip: { candidate: C; because: C | null }[] = [];
  for (const c of order) {
    const clash = enter.find((e) => overlaps(e, c));
    if (clash) skip.push({ candidate: c, because: clash });
    else if (committed.some((t) => overlaps(t, c))) skip.push({ candidate: c, because: null });
    else enter.push(c);
  }
  return { enter, skip };
}

// Statuses that mean he's going (or trying to): these block other
// tournaments on the same dates and feed the sync and the draw watch.
export const ACTIVE_ENTRY: readonly EntryStatus[] = ["entered", "payment_needed", "main_draw", "reserve"];
