import ICAL from "ical.js";
import { categorise } from "../../domain/categories";
import { addDays, isValidTimeZone, zonedToUtc } from "../../domain/time";
import type { SourceRecord } from "../../domain/upsert";
import { FetchError, normaliseFeedUrl, politeFetch } from "../http";
import { SyncError, type Adapter, type AdapterContext, type NormalisedBatch } from "../types";

// Generic iCal feed adapter (SRC-2/3/7/9): TeamSnap, Spordle and Veracross
// calendar subscription links, or any other .ics feed. The link itself is a
// secret (spec §7.3) and comes from the source's credential.

const PAST_DAYS = 30;
const FUTURE_DAYS = 400;
const MAX_OCCURRENCES = 1000;

type IcalTime = InstanceType<typeof ICAL.Time> & { timezone?: string };

function toUtc(t: IcalTime, fallbackTz: string, hintTz?: string): Date {
  const fields = {
    year: t.year,
    month: t.month,
    day: t.day,
    hour: t.hour,
    minute: t.minute,
    second: t.second,
  };
  if (t.isDate) return new Date(Date.UTC(t.year, t.month - 1, t.day));
  if (t.zone?.tzid === "UTC")
    return new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second));
  const tz = [t.timezone, t.zone?.tzid !== "floating" ? t.zone?.tzid : undefined, hintTz].find(
    (z): z is string => !!z && isValidTimeZone(z),
  );
  return zonedToUtc(fields, tz ?? fallbackTz);
}

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, 2000) : null;
}

export function parseIcs(body: string, ctx: AdapterContext): NormalisedBatch {
  let root: InstanceType<typeof ICAL.Component>;
  try {
    root = new ICAL.Component(ICAL.parse(body));
  } catch {
    throw new SyncError("The calendar feed couldn't be read. The link may point to the wrong page.");
  }
  const from = new Date(`${addDays(ctx.now.toISOString().slice(0, 10), -PAST_DAYS)}T00:00:00Z`);
  const to = new Date(`${addDays(ctx.now.toISOString().slice(0, 10), FUTURE_DAYS)}T00:00:00Z`);
  const warnings: string[] = [];

  // Group by UID: the master event plus any modified occurrences.
  const byUid = new Map<
    string,
    { master?: InstanceType<typeof ICAL.Component>; exceptions: InstanceType<typeof ICAL.Component>[] }
  >();
  for (const vevent of root.getAllSubcomponents("vevent")) {
    const uid = String(vevent.getFirstPropertyValue("uid") ?? "");
    if (!uid) {
      warnings.push("An event without an ID was skipped.");
      continue;
    }
    const entry = byUid.get(uid) ?? { exceptions: [] };
    if (vevent.hasProperty("recurrence-id")) entry.exceptions.push(vevent);
    else entry.master = vevent;
    byUid.set(uid, entry);
  }

  const records: SourceRecord[] = [];
  const push = (
    uid: string,
    key: string | null,
    ev: InstanceType<typeof ICAL.Event>,
    start: IcalTime,
    end: IcalTime,
    hintTz?: string,
  ) => {
    if (String(ev.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
    const startUtc = toUtc(start, ctx.homeTimeZone, hintTz);
    let endUtc = toUtc(end, ctx.homeTimeZone, hintTz);
    if (endUtc < startUtc) endUtc = startUtc;
    const title = text(ev.summary) ?? "(no title)";
    const { category, attendance } = categorise(title, ctx.source.mapping);
    records.push({
      externalId: key ? `${uid}#${key}` : uid,
      category,
      attendance,
      title,
      notes: text(ev.description),
      locationName: text(ev.location),
      startUtc,
      endUtc,
      allDay: start.isDate,
      sourceUrl: text(ev.component.getFirstPropertyValue("url")),
    });
  };

  for (const [uid, { master, exceptions }] of byUid) {
    if (!master) {
      // Only modified occurrences: treat each as a single event.
      for (const ex of exceptions) {
        const ev = new ICAL.Event(ex);
        push(
          uid,
          (ev.recurrenceId as IcalTime).toString(),
          ev,
          ev.startDate as IcalTime,
          ev.endDate as IcalTime,
        );
      }
      continue;
    }
    const ev = new ICAL.Event(master);
    for (const ex of exceptions) ev.relateException(ex);
    const masterTz = (ev.startDate as IcalTime).timezone;
    if (!ev.isRecurring()) {
      push(uid, null, ev, ev.startDate as IcalTime, ev.endDate as IcalTime, masterTz);
      continue;
    }
    const it = ev.iterator();
    let n = 0;
    for (let next = it.next(); next; next = it.next()) {
      const occStart = toUtc(next as IcalTime, ctx.homeTimeZone, masterTz);
      if (occStart >= to) break;
      if (++n > MAX_OCCURRENCES) {
        warnings.push(
          `"${text(ev.summary)}" repeats too often; only the first ${MAX_OCCURRENCES} were kept.`,
        );
        break;
      }
      const details = ev.getOccurrenceDetails(next);
      const detailStart = details.startDate as IcalTime;
      const startUtc = toUtc(detailStart, ctx.homeTimeZone, detailStart.timezone ?? masterTz);
      if (startUtc < from) continue;
      // The occurrence key is its original start, stable even if moved.
      push(
        uid,
        (next as IcalTime).toString(),
        details.item,
        detailStart,
        details.endDate as IcalTime,
        masterTz,
      );
    }
  }

  return { records, window: { from, to }, warnings };
}

export const icalAdapter: Adapter<string> = {
  kind: "ical",
  label: "Calendar feed (iCal link)",
  credentialKinds: ["secret_url"],
  async fetchRaw(ctx) {
    if (!ctx.credential?.secret) throw new SyncError("No calendar link is set. Add it on the Accounts page.");
    try {
      const res = await politeFetch(normaliseFeedUrl(ctx.credential.secret));
      if (res.status === 404 || res.status === 410)
        throw new SyncError("The calendar link no longer works. Copy a fresh link from the site.");
      if (res.status === 401 || res.status === 403)
        throw new SyncError("The calendar site refused the link. Copy a fresh link from the site.");
      if (!res.ok)
        throw new SyncError(`The calendar site answered with an error (${res.status}). Try again later.`);
      return await res.text();
    } catch (err) {
      if (err instanceof FetchError) throw new SyncError(err.message);
      throw err;
    }
  },
  normalise: parseIcs,
};
