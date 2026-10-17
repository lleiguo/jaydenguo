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
};

export type HouseholdLink = { hubKey: string; googleEventId: string; origin: "hub" | "twin"; hash: string };

// A twin keeps its family-written title and notes (DUP2-2): only its time,
// place and tag are sent.
export type TwinPatch = Pick<GoogleEventBody, "start" | "end" | "extendedProperties"> & { location?: string };

export type HouseholdPlan = {
  create: { hubKey: string; body: GoogleEventBody; hash: string }[];
  update: { hubKey: string; googleEventId: string; body: GoogleEventBody | TwinPatch; hash: string }[];
  link: { hubKey: string; googleEventId: string; body: TwinPatch; hash: string }[];
  remove: { hubKey: string; googleEventId: string }[];
  unlink: { hubKey: string; googleEventId: string }[];
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

  const plan: HouseholdPlan = { create: [], update: [], link: [], remove: [], unlink: [], held: null };
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

  const changes = plan.update.length + plan.link.length + plan.unlink.length;
  if (!input.overrideBrake) {
    if (plan.remove.length > BRAKE.deletes)
      plan.held = `It would delete ${plan.remove.length} events from the household calendar.`;
    else if (changes > BRAKE.changes)
      plan.held = `It would change ${changes} events in the household calendar.`;
  }
  return plan;
}
