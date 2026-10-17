import { createHash } from "node:crypto";
import { googleEventBody, type GoogleEventBody } from "./calendar-copy";
import { namedIn } from "./categories";
import type { Category } from "./constants";
import { HOUSEHOLD_KINDS, sameEvent, type DedupEvent } from "./duplicates";
import type { Person } from "./people";
import { schoolBlocks } from "./school-blocks";

// What the household Google Calendar should hold of the hub's events
// (intent 0020, TWO, DUP2-2, TWSEC-2), and which Google events to create,
// change, link, unlink or delete to get there. Pure, so the rules are
// unit-tested; the worker job reads the hub and Google and writes the plan.

export const WINDOW_DAYS = 366;
// TWSEC-2: a run that would delete or change more than this stops.
export const BRAKE = { deletes: 10, changes: 50 };

export type PlanItem = {
  id: string;
  // Null for events added on the site.
  sourceKind: string | null;
  title: string;
  category: Category;
  // Resolved owners.
  owners: string[];
  // Effective times (after any override), ISO.
  start: string;
  end: string;
  allDay: boolean;
  locationName: string | null;
  notes: string | null;
  // Active, not deleted and not skipped.
  active: boolean;
  repeats: boolean;
  createdAt: Date;
  // A household event's own Google ID.
  googleEventId?: string | null;
  // Added on the site (not a series) or from an applied email: Google edits
  // change the event itself (BACK-4), not an override (BACK-3).
  hubMade?: boolean;
  // When the hub last changed it (the event or its override), for BACK-5.
  changedAt?: Date;
  // Its active override, if any, and whether it was deleted here (TWO-4).
  override?: { id: string; moved: boolean; skip: boolean } | null;
  deleted?: boolean;
};

export type HouseholdLink = {
  hubKey: string;
  googleEventId: string;
  origin: "hub" | "twin";
  hash: string;
  // Google's `updated` when the hub last wrote or read it (BACK-5).
  googleUpdatedAt?: Date | null;
};

// TWO-4: a household event moved, skipped (one of a repeating series) or
// deleted in the hub. Its own Google event is patched or deleted, then the
// hub's override is cleared.
export type HouseholdEdit =
  | {
      kind: "patch";
      eventId: string;
      googleEventId: string;
      overrideId: string | null;
      body: Pick<GoogleEventBody, "start" | "end">;
      start: string;
      end: string;
    }
  | { kind: "remove"; eventId: string; googleEventId: string; overrideId: string | null };

// A twin keeps its family-written title and notes (DUP2-2): only its time,
// place and tag are sent.
export type TwinPatch = Pick<GoogleEventBody, "start" | "end" | "extendedProperties"> & { location?: string };

export type HouseholdPlan = {
  create: { hubKey: string; body: GoogleEventBody; hash: string }[];
  update: { hubKey: string; googleEventId: string; body: GoogleEventBody | TwinPatch; hash: string }[];
  link: { hubKey: string; googleEventId: string; body: TwinPatch; hash: string }[];
  remove: { hubKey: string; googleEventId: string }[];
  unlink: { hubKey: string; googleEventId: string }[];
  edits: HouseholdEdit[];
  // Why the run stopped without writing (TWSEC-2), or null.
  held: string | null;
};

const hash = (b: unknown) => createHash("sha256").update(JSON.stringify(b)).digest("hex");

// TWO-2: the title names whose event it is, so reading Household back gives
// the same owners (`ownersFor`). Everyone's events need no names.
export function householdTitle(title: string, owners: readonly string[], people: readonly Person[]): string {
  if (people.length > 1 && people.every((p) => owners.includes(p.id))) return title;
  const missing = people.filter((p) => owners.includes(p.id) && !namedIn(title, p.name)).map((p) => p.name);
  return missing.length ? `${missing.join(" + ")} – ${title}` : title;
}

type Wanted = {
  key: string;
  title: string;
  category: Category;
  owners: string[];
  start: string;
  end: string;
  allDay: boolean;
  locationName: string | null;
  notes: string | null;
  active: boolean;
  feed: boolean;
};

export function householdBody(w: Wanted, people: readonly Person[], timeZone: string): GoogleEventBody {
  const copy = googleEventBody(
    { ...w, id: w.key, title: householdTitle(w.title, w.owners, people) },
    timeZone,
  );
  return {
    ...copy,
    description: copy.description.replace("Copied from the family hub.", "From the family hub."),
  };
}

function twinPatch(body: GoogleEventBody): TwinPatch {
  const p: TwinPatch = { start: body.start, end: body.end, extendedProperties: body.extendedProperties };
  if (body.location) p.location = body.location;
  return p;
}

// Everything the hub would put in Household, past and future, keyed: one
// item per event, and a school day's classes as one block per child (TWO-5).
function hubItems(items: PlanItem[], timeZone: string): Wanted[] {
  const hub = items.filter((i) => !(i.sourceKind && HOUSEHOLD_KINDS.includes(i.sourceKind)));
  const blocks = schoolBlocks(
    hub.filter((i) => i.active),
    timeZone,
  );
  const inBlock = new Set(blocks.flatMap((b) => b.classes.map((c) => c.id)));
  const one = (i: PlanItem): Wanted => ({
    key: i.id,
    title: i.title,
    category: i.category,
    owners: i.owners,
    start: i.start,
    end: i.end,
    allDay: i.allDay,
    locationName: i.locationName,
    notes: i.notes,
    active: i.active,
    feed: !!i.sourceKind,
  });
  return [
    ...hub.filter((i) => !inBlock.has(i.id)).map(one),
    ...blocks.map((b) => ({
      key: `school:${b.key}`,
      title: "School",
      category: "school_class" as Category,
      owners: b.owners,
      start: b.start,
      end: b.end,
      allDay: false,
      locationName: null,
      notes: null,
      active: true,
      feed: true,
    })),
  ];
}

const dedup = (
  w: {
    key: string;
    title: string;
    category: Category;
    owners: string[];
    start: string;
    end: string;
    allDay: boolean;
  },
  kind: string | null,
): DedupEvent => ({
  id: w.key,
  sourceKind: kind,
  title: w.title,
  category: w.category,
  owners: w.owners,
  start: new Date(w.start),
  end: new Date(w.end),
  allDay: w.allDay,
  repeats: false,
  createdAt: new Date(0),
});

export function planHousehold(input: {
  // Every hub and household event the job loaded, including deleted and
  // skipped ones that have a link.
  items: PlanItem[];
  people: readonly Person[];
  links: HouseholdLink[];
  timeZone: string;
  now: Date;
  // Only true for a run the owner approved ("Apply anyway").
  overrideBrake?: boolean;
}): HouseholdPlan {
  const { items, people, links, timeZone, now } = input;
  const horizon = new Date(now.getTime() + WINDOW_DAYS * 86_400_000);
  const all = hubItems(items, timeZone);
  const byKey = new Map(all.map((w) => [w.key, w]));
  // TWO-7: what has ended is never touched, whatever its state.
  const past = (w: Wanted) => Date.parse(w.end) <= now.getTime();
  const wanted = all.filter((w) => w.active && !past(w) && Date.parse(w.start) < horizon.getTime());
  const have = new Map(links.map((l) => [l.hubKey, l]));
  const linkedGoogle = new Set(links.map((l) => l.googleEventId));

  const household = items.filter(
    (i) =>
      i.sourceKind &&
      HOUSEHOLD_KINDS.includes(i.sourceKind) &&
      i.active &&
      i.googleEventId &&
      Date.parse(i.end) > now.getTime(),
  );

  const plan: HouseholdPlan = {
    create: [],
    update: [],
    link: [],
    remove: [],
    unlink: [],
    edits: householdEdits(items, linkedGoogle, now, timeZone),
    held: null,
  };
  for (const w of wanted) {
    const body = householdBody(w, people, timeZone);
    const link = have.get(w.key);
    if (link) {
      const next = link.origin === "twin" ? twinPatch(body) : body;
      const h = hash(next);
      if (h !== link.hash)
        plan.update.push({ hubKey: w.key, googleEventId: link.googleEventId, body: next, hash: h });
      continue;
    }
    // DUP2-2: a hand-made household event for the same thing is linked,
    // not doubled. Only a feed's event links; one made on the site is new.
    const twin = w.feed
      ? household.find(
          (h) =>
            !linkedGoogle.has(h.googleEventId!) &&
            sameEvent(dedup({ ...h, key: h.id }, h.sourceKind), dedup(w, "feed")),
        )
      : undefined;
    if (twin) {
      linkedGoogle.add(twin.googleEventId!);
      const patch = twinPatch(body);
      plan.link.push({ hubKey: w.key, googleEventId: twin.googleEventId!, body: patch, hash: hash(patch) });
      continue;
    }
    plan.create.push({ hubKey: w.key, body, hash: hash(body) });
  }

  const want = new Set(wanted.map((w) => w.key));
  for (const l of links) {
    if (want.has(l.hubKey)) continue;
    const w = byKey.get(l.hubKey);
    if (w && past(w)) continue;
    const gone = { hubKey: l.hubKey, googleEventId: l.googleEventId };
    // A twin is the family's own event: it is untagged, never deleted.
    if (l.origin === "twin") plan.unlink.push(gone);
    else plan.remove.push(gone);
  }

  const removes = plan.remove.length + plan.edits.filter((e) => e.kind === "remove").length;
  const changes =
    plan.update.length +
    plan.link.length +
    plan.unlink.length +
    plan.edits.filter((e) => e.kind === "patch").length;
  if (!input.overrideBrake) {
    if (removes > BRAKE.deletes) plan.held = `It would delete ${removes} events from the household calendar.`;
    else if (changes > BRAKE.changes)
      plan.held = `It would change ${changes} events in the household calendar.`;
  }
  return plan;
}

// TWO-4: the household calendar's own events that were changed in the hub
// and not yet in Google. A skip of a one-off household event stays in the
// hub (the family may still go); a skip of one of a series cancels that one.
function householdEdits(
  items: PlanItem[],
  linkedGoogle: ReadonlySet<string>,
  now: Date,
  timeZone: string,
): HouseholdEdit[] {
  const edits: HouseholdEdit[] = [];
  for (const i of items) {
    if (!i.sourceKind || !HOUSEHOLD_KINDS.includes(i.sourceKind) || !i.googleEventId) continue;
    // A linked twin is the feed's event in Google now; TWO-7: not the past.
    if (linkedGoogle.has(i.googleEventId) || Date.parse(i.end) <= now.getTime()) continue;
    const overrideId = i.override?.id ?? null;
    if (i.deleted || (i.override?.skip && i.repeats))
      edits.push({ kind: "remove", eventId: i.id, googleEventId: i.googleEventId, overrideId });
    else if (i.override?.moved && !i.override.skip) {
      const b = googleEventBody({ ...i, notes: null, locationName: null }, timeZone);
      edits.push({
        kind: "patch",
        eventId: i.id,
        googleEventId: i.googleEventId,
        overrideId,
        body: { start: b.start, end: b.end },
        start: i.start,
        end: i.end,
      });
    }
  }
  return edits;
}

// What Google says an event is now, as the job read it; "gone" when it was
// deleted there.
export type GoogleSeen = {
  summary?: string;
  location?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  updated?: string;
};

export { GOOGLE_ACTOR } from "./constants";

// BACK-3..5: a change made in Google to an event the hub wrote.
export type BackChange =
  // A feed's (or a series') event moved in Google: an override, as a drag.
  | { kind: "move"; eventId: string; start: string; end: string }
  // A feed's event deleted in Google: skipped in the hub.
  | { kind: "skip"; eventId: string }
  // An event added here moved or edited in Google: the event takes it.
  | {
      kind: "edit";
      eventId: string;
      title?: string;
      start: string;
      end: string;
      allDay: boolean;
      locationName: string | null;
    }
  // An event added here deleted in Google: deleted in the hub.
  | { kind: "delete"; eventId: string };

export type ReadBack = {
  changes: BackChange[];
  // BACK-5: changed on both sides and the hub's change was later; the next
  // write puts the hub's version back.
  hubWon: string[];
  // Links to bring up to date: Google's `updated` as read, and an empty
  // hash where Google holds a title or place the hub doesn't (BACK-3), so
  // the write sends the hub's version again.
  seen: { hubKey: string; updated: string | null; stale: boolean }[];
  // Deleted in Google.
  gone: string[];
};

const instant = (t: { date?: string; dateTime?: string }) =>
  Date.parse(t.dateTime ?? (t.date ? `${t.date}T00:00:00Z` : "")) || 0;
const sameText = (a: string | undefined | null, b: string | undefined | null) =>
  (a ?? "").trim() === (b ?? "").trim();

// Compares each event the hub wrote with what Google holds now. Only events
// Google says changed since the hub last saw them (`updated`) and that now
// differ in time, title or place count (BACK-2). Past events, school days
// and events no longer in the hub are left to the write (TWO-7).
export function readBack(input: {
  items: PlanItem[];
  people: readonly Person[];
  links: HouseholdLink[];
  google: ReadonlyMap<string, GoogleSeen | "gone">;
  timeZone: string;
  now: Date;
}): ReadBack {
  const { people, timeZone, now } = input;
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const out: ReadBack = { changes: [], hubWon: [], seen: [], gone: [] };
  for (const link of input.links) {
    const item = byId.get(link.hubKey);
    if (!item || Date.parse(item.end) <= now.getTime()) continue;
    const g = input.google.get(link.googleEventId);
    if (!g) continue;
    const hubMade = !!item.hubMade && link.origin === "hub";
    if (g === "gone") {
      if (!item.active) continue;
      // A delete has no time to weigh against the hub's (BACK-5): it wins.
      out.changes.push(hubMade ? { kind: "delete", eventId: item.id } : { kind: "skip", eventId: item.id });
      out.gone.push(link.hubKey);
      continue;
    }
    const seenAt = link.googleUpdatedAt?.getTime();
    const updated = g.updated ? Date.parse(g.updated) : NaN;
    if (!seenAt || !updated || updated <= seenAt) continue;

    const body = householdBody(
      { ...item, key: item.id, feed: !!item.sourceKind, active: true },
      people,
      timeZone,
    );
    const ours = link.origin === "twin" ? twinPatch(body) : body;
    const moved = instant(g.start) !== instant(ours.start) || instant(g.end) !== instant(ours.end);
    // A twin keeps the family's own title (DUP2-2).
    const retitled = link.origin === "hub" && !sameText(g.summary, body.summary);
    // A twin's place is the family's unless the hub has one.
    const replaced = (link.origin === "hub" || !!ours.location) && !sameText(g.location, ours.location);
    const seen = { hubKey: link.hubKey, updated: g.updated!, stale: false };
    out.seen.push(seen);
    if (!moved && !retitled && !replaced) continue;

    // BACK-5: both changed since the last run; the later one wins.
    const hubChanged = hash(ours) !== link.hash;
    if (hubChanged && item.changedAt && item.changedAt.getTime() >= updated) {
      out.hubWon.push(link.hubKey);
      continue;
    }
    if (hubMade) {
      const allDay = !!g.start.date;
      out.changes.push({
        kind: "edit",
        eventId: item.id,
        ...(retitled ? { title: g.summary?.trim() || "(no title)" } : {}),
        start: new Date(instant(g.start)).toISOString(),
        end: new Date(Math.max(instant(g.end), instant(g.start))).toISOString(),
        allDay,
        locationName: g.location?.trim() || null,
      });
      continue;
    }
    // BACK-3: a feed's event holds only a time of its own; its title and
    // place go back to the hub's at the write.
    if (moved)
      out.changes.push({
        kind: "move",
        eventId: item.id,
        start: new Date(instant(g.start)).toISOString(),
        end: new Date(Math.max(instant(g.end), instant(g.start))).toISOString(),
      });
    if (retitled || replaced) seen.stale = true;
  }
  return out;
}

// BACK-4, T-6: a title read back from Google loses the "Jayden – " the hub
// put in front (TWO-2), and those named become the owners. Without it, the
// owners are null: read them as a household event's (`ownersFor`).
export function titleFromGoogle(
  summary: string,
  people: readonly Pick<Person, "id" | "name">[],
): { title: string; owners: string[] | null } {
  const m = /^(.+?) – (.+)$/u.exec(summary);
  if (m) {
    const named = m[1].split(" + ").map((n) => people.find((p) => p.name === n.trim()));
    if (named.every(Boolean)) return { title: m[2].trim(), owners: named.map((p) => p!.id) };
  }
  return { title: summary, owners: null };
}
