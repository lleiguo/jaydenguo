import { parse } from "node-html-parser";
import { categorise } from "../../domain/categories";
import { addDays, weekday } from "../../domain/time";
import type { SourceRecord } from "../../domain/upsert";
import { FetchError, normaliseFeedUrl, politeFetch } from "../http";
import { SyncError, type Adapter, type AdapterContext, type NormalisedBatch } from "../types";

// A school's public "Key Dates at a Glance" page (SCH-2, CAL-7; spikes.md
// SP-4): a heading with the school year, e.g. "2026-2027 Key Dates at a
// Glance", then a list of "Friday, Sept. 4: New Student Day" or
// "Monday, Dec. 21 - Friday, Jan. 8: Winter Break (No Classes)". Each item
// becomes an all-day event; the source's category rules turn closures into
// school_closure banners. Used until a school calendar feed is available.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// The school year starts in August: months before it belong to the second year.
const FIRST_MONTH = 8;

const DAY = String.raw`(?:([a-z]+)\.?,?\s*)?([a-z]+)\.?\s*(\d{1,2})`;
const ITEM = new RegExp(
  String.raw`^${DAY}(?:\s*[-–—]\s*(?:([a-z]+)\.?,?\s*)?(?:([a-z]+)\.?\s*)?(\d{1,2}))?\s*:\s*(.+)$`,
  "i",
);

export type SchoolDate = { start: string; end: string; title: string };
export type SchoolDatesConfig = { pageUrl?: string; exclude?: string };

const clean = (s: string) =>
  s
    .replace(/&nbsp;| /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const monthOf = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;

export function parseKeyDates(html: string): {
  schoolYear: [number, number];
  dates: SchoolDate[];
  warnings: string[];
} {
  const root = parse(html);
  const heading = root
    .querySelectorAll("h1, h2, h3, h4")
    .find((h) => /\d{4}\s*[-–]\s*\d{4}.*key dates/i.test(clean(h.text)));
  const years = heading && clean(heading.text).match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (!heading || !years) throw new SyncError('The page has no "Key Dates" list with a school year.');
  const [y1, y2] = [Number(years[1]), Number(years[2])];

  // The first list after the heading.
  let list = heading.nextElementSibling;
  while (list && list.tagName !== "UL" && list.tagName !== "OL") list = list.nextElementSibling;
  if (!list) throw new SyncError('The page has no "Key Dates" list with a school year.');

  const warnings: string[] = [];
  const dates: SchoolDate[] = [];
  for (const li of list.querySelectorAll("li")) {
    const line = clean(li.text);
    const m = line.match(ITEM);
    const month = m ? monthOf(m[2]) : 0;
    const endMonth = m?.[5] ? monthOf(m[5]) : month;
    if (!m || !month || !endMonth) {
      warnings.push(`A key date couldn't be read: "${line.slice(0, 80)}"`);
      continue;
    }
    const iso = (mon: number, day: number) =>
      `${mon >= FIRST_MONTH ? y1 : y2}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const start = iso(month, Number(m[3]));
    const last = iso(endMonth, Number(m[6] ?? m[3]));
    for (const [name, date] of [
      [m[1], start],
      [m[4], last],
    ] as const) {
      const want = name ? WEEKDAYS.indexOf(name.slice(0, 3).toLowerCase()) : -1;
      if (want >= 0 && want !== weekday(date))
        warnings.push(`"${line.slice(0, 80)}": ${date} isn't a ${name}; check the page's year.`);
    }
    if (last < start) {
      warnings.push(`A key date ends before it starts: "${line.slice(0, 80)}"`);
      continue;
    }
    dates.push({ start, end: addDays(last, 1), title: m[7].trim().slice(0, 200) });
  }
  return { schoolYear: [y1, y2], dates, warnings };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export function normaliseSchoolDates(html: string, ctx: AdapterContext): NormalisedBatch {
  const config = ctx.source.config as SchoolDatesConfig;
  const { schoolYear, dates, warnings } = parseKeyDates(html);
  // Items that aren't his, e.g. "Sr. School Only" when he's in Junior School.
  const exclude = (config.exclude ?? "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const records: SourceRecord[] = [];
  for (const d of dates) {
    if (exclude.some((w) => d.title.toLowerCase().includes(w))) continue;
    const { category, attendance } = categorise(d.title, ctx.source.mapping);
    records.push({
      externalId: `${d.start}:${slug(d.title)}`,
      category,
      attendance,
      title: d.title,
      notes: null,
      locationName: null,
      startUtc: new Date(`${d.start}T00:00:00Z`),
      endUtc: new Date(`${d.end}T00:00:00Z`),
      allDay: true,
      sourceUrl: config.pageUrl ?? null,
    });
  }
  // Only this school year's dates can be cancelled for going missing, so
  // last year's stay when the page moves on (SyncWindow).
  const window = {
    from: new Date(`${schoolYear[0]}-0${FIRST_MONTH}-01T00:00:00Z`),
    to: new Date(`${schoolYear[1]}-0${FIRST_MONTH}-01T00:00:00Z`),
  };
  if (!records.length) warnings.push("The key dates list is empty.");
  return { records, window, warnings };
}

export const schoolDatesAdapter: Adapter<string> = {
  kind: "school_dates",
  label: "School key dates (public page)",
  credentialKinds: [],
  async fetchRaw(ctx) {
    const pageUrl = (ctx.source.config as SchoolDatesConfig).pageUrl;
    if (!pageUrl) throw new SyncError("No page link is set. Add it on the Sources page.");
    try {
      const res = await politeFetch(normaliseFeedUrl(pageUrl));
      if (!res.ok)
        throw new SyncError(`The school's site answered with an error (${res.status}). Try again later.`);
      return await res.text();
    } catch (err) {
      if (err instanceof FetchError) throw new SyncError(err.message);
      throw err;
    }
  },
  normalise: normaliseSchoolDates,
};
