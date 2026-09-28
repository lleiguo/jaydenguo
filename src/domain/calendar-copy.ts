import { createHash } from "node:crypto";

// What the Google Calendar copy should hold (plan M5.9, GCO-1): every
// active, not-skipped event, as the calendar shows it (with the owner's
// moves), and which Google events to create, change or delete. Pure, so the
// sync rules are unit-tested.

export const COPY_CALENDAR_NAME = "Jayden (hub)";

export type CopySource = {
  id: string;
  title: string;
  category: string;
  start: string;
  end: string;
  allDay: boolean;
  locationName: string | null;
  notes: string | null;
};

export type GoogleEventBody = {
  summary: string;
  description: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  extendedProperties: { private: { hubEventId: string } };
};

const day = (iso: string) => iso.slice(0, 10);
const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function googleEventBody(e: CopySource, timeZone: string): GoogleEventBody {
  const category = e.category.replace("_", " ");
  const body: GoogleEventBody = {
    summary: e.title,
    description: [`${category[0].toUpperCase()}${category.slice(1)}`, e.notes, "Copied from the family hub."]
      .filter(Boolean)
      .join("\n\n"),
    start: e.allDay ? { date: day(e.start) } : { dateTime: e.start, timeZone },
    // All-day ends are exclusive in Google Calendar, and must be after the start.
    end: e.allDay
      ? { date: day(e.end) > day(e.start) ? day(e.end) : nextDay(day(e.start)) }
      : { dateTime: e.end > e.start ? e.end : e.start, timeZone },
    extendedProperties: { private: { hubEventId: e.id } },
  };
  if (e.locationName) body.location = e.locationName;
  return body;
}

export const bodyHash = (b: GoogleEventBody) => createHash("sha256").update(JSON.stringify(b)).digest("hex");

export type CopyMapping = { eventId: string; googleEventId: string; hash: string };
export type Desired = { eventId: string; body: GoogleEventBody; hash: string };

export function planCopy(desired: Desired[], existing: CopyMapping[]) {
  const have = new Map(existing.map((m) => [m.eventId, m]));
  const want = new Set(desired.map((d) => d.eventId));
  const create: Desired[] = [];
  const update: (Desired & { googleEventId: string })[] = [];
  for (const d of desired) {
    const m = have.get(d.eventId);
    if (!m) create.push(d);
    else if (m.hash !== d.hash) update.push({ ...d, googleEventId: m.googleEventId });
  }
  const remove = existing.filter((m) => !want.has(m.eventId));
  return { create, update, remove };
}
