import { categorise } from "../../domain/categories";
import { eventLabel, normaliseCourse, normaliseStroke, formatSwimTime } from "../../domain/swim";
import type { Course } from "../../domain/swim-constants";
import type { SwimEntryRecord, SwimMeetRecord, SwimResultRecord, SwimSplit } from "../../domain/swim-upsert";
import { addDays, isValidTimeZone, localDate } from "../../domain/time";
import type { SourceRecord } from "../../domain/upsert";
import type { AdapterContext, NormalisedBatch } from "../types";
import type { CommitRaw, CommitSignup, CommitSwim } from "./extract";

// Turns what the extractor read from Commit Swimming into swim meets,
// entries and results, plus calendar events for the meets (SWM-1..3). Pure,
// so it's tested from the recorded fixture. Quirks handled here are listed
// in spikes.md (SP-3).

const PAST_DAYS = 30;
const cs = (v: number | null) => (v != null && v > 0 ? v * 10 : null);
const utcDate = (iso: string) => iso.slice(0, 10);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !/^\d+$/.test(w) && w !== "meet"),
  );

function entryRecords(s: CommitSignup, fallbackCourse: Course | null, warnings: string[]): SwimEntryRecord[] {
  const out: SwimEntryRecord[] = [];
  for (const e of s.entries) {
    const stroke = normaliseStroke(e.stroke);
    const course = normaliseCourse(e.course) ?? fallbackCourse;
    if (!stroke || !course || !(e.distance > 0)) {
      warnings.push(`An entry at "${s.title}" had an unknown event and was skipped.`);
      continue;
    }
    out.push({ distance: e.distance, stroke, course, seedTimeMs: cs(e.seedTime) });
  }
  return out;
}

// Per-leg splits, kept only when every leg has a time and they add up to the
// race time (some uploads carry placeholders).
function splitsFor(
  raceCs: number | null,
  legs: { leg: number; distance: number; time: number | null }[],
): SwimSplit[] {
  if (!raceCs || !legs.length) return [];
  const sorted = [...legs].sort((a, b) => a.leg - b.leg);
  if (sorted.some((l) => !l.time || l.time <= 0 || !(l.distance > 0))) return [];
  const total = sorted.reduce((sum, l) => sum + l.time!, 0);
  if (Math.abs(total - raceCs) > 1) return [];
  return sorted.map((l) => ({ distance: l.distance, ms: l.time! * 10 }));
}

export function normaliseCommit(raw: CommitRaw, ctx: AdapterContext): NormalisedBatch {
  const warnings: string[] = [];
  const today = localDate(ctx.now, ctx.homeTimeZone);
  const from = new Date(`${addDays(today, -PAST_DAYS)}T00:00:00Z`);
  const meetsUrl = `${raw.siteUrl}/meets`;
  const resultsUrl = `${raw.siteUrl}/results`;

  // 1. Result meets: one meet uploaded several times becomes one.
  const canonicalMeet = new Map<string, string>();
  const resultMeets = new Map<string, CommitRaw["meets"][number]>();
  const byKey = new Map<string, string>();
  for (const m of [...raw.meets].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = [m.name.trim().toLowerCase(), m.start, m.end].join("|");
    const first = byKey.get(key);
    if (first) canonicalMeet.set(m.id, first);
    else {
      byKey.set(key, m.id);
      canonicalMeet.set(m.id, m.id);
      resultMeets.set(m.id, m);
    }
  }

  // 2. Sign-ups the athlete didn't decline. Their dates are midnight to
  //    midnight in the meet's time zone.
  const signups = raw.signups
    .filter((s) => s.answer !== "no")
    .map((s) => {
      const tz = s.timeZone && isValidTimeZone(s.timeZone) ? s.timeZone : ctx.homeTimeZone;
      const startDate = localDate(new Date(s.start), tz);
      const endDate = localDate(new Date(s.end), tz);
      return { s, startDate, endDate: endDate < startDate ? startDate : endDate };
    });

  // 3. Tie each result meet to its sign-up when it's the same meet: same
  //    start date, and a shared word in the name when several match.
  const signupForResult = new Map<string, string>();
  const claimed = new Set<string>();
  for (const m of resultMeets.values()) {
    if (!m.start) continue;
    const candidates = signups.filter(
      (x) => x.s.isMeet && x.startDate === utcDate(m.start!) && !claimed.has(x.s.id),
    );
    const named = candidates.filter((x) => [...words(x.s.title)].some((w) => words(m.name).has(w)));
    const pick = candidates.length === 1 ? candidates[0] : named.length === 1 ? named[0] : undefined;
    if (pick) {
      signupForResult.set(m.id, pick.s.id);
      claimed.add(pick.s.id);
    }
  }
  const resultMeetExternalId = (canonicalId: string) => {
    const signupId = signupForResult.get(canonicalId);
    return signupId ? `signup:${signupId}` : `result:${canonicalId}`;
  };

  // 4. Meets.
  const meets: SwimMeetRecord[] = [];
  const resultBySignup = new Map([...signupForResult].map(([r, s]) => [s, resultMeets.get(r)!]));
  for (const { s, startDate, endDate } of signups) {
    if (!s.isMeet) continue;
    const result = resultBySignup.get(s.id);
    const course = normaliseCourse(result?.course) ?? normaliseCourse(s.course);
    meets.push({
      externalId: `signup:${s.id}`,
      // The official name once results are in; the club's title before.
      name: result?.name ?? s.title,
      course,
      startDate,
      endDate,
      venue: s.venue,
      city: result?.city ?? s.city,
      signup: s.answer,
      sourceUrl: result ? resultsUrl : meetsUrl,
      entries: entryRecords(s, course, warnings),
    });
  }
  for (const m of resultMeets.values()) {
    if (signupForResult.has(m.id) || !m.start) continue;
    const startDate = utcDate(m.start);
    const endDate = m.end && utcDate(m.end) > startDate ? utcDate(m.end) : startDate;
    meets.push({
      externalId: `result:${m.id}`,
      name: m.name,
      course: normaliseCourse(m.course),
      startDate,
      endDate,
      venue: null,
      city: m.city,
      signup: null,
      sourceUrl: resultsUrl,
      entries: null,
    });
  }
  const meetByExternalId = new Map(meets.map((m) => [m.externalId, m]));

  // 5. Results: individual swims only, each swim once.
  const splitsBySwim = new Map<string, CommitRaw["splits"]>();
  for (const sp of raw.splits) {
    const list = splitsBySwim.get(sp.resultId) ?? [];
    list.push(sp);
    splitsBySwim.set(sp.resultId, list);
  }
  const seen = new Map<string, CommitSwim>();
  for (const s of [...raw.swims].sort((a, b) => a.id.localeCompare(b.id))) {
    if (s.relay) continue;
    const key = [s.date?.slice(0, 10), s.distance, s.stroke, s.course, s.stage, s.raceTime, s.dq].join("|");
    if (!seen.has(key)) seen.set(key, s);
  }
  const results: SwimResultRecord[] = [];
  for (const s of seen.values()) {
    const stroke = normaliseStroke(s.stroke);
    const course = normaliseCourse(s.course);
    if (!stroke || !course || !(s.distance >= 25)) {
      warnings.push("A result with an unknown event was skipped.");
      continue;
    }
    const canonical = canonicalMeet.get(s.meetId);
    const meetExternalId = canonical ? resultMeetExternalId(canonical) : null;
    const meet = meetExternalId ? meetByExternalId.get(meetExternalId) : undefined;
    const swimDate = s.date ? utcDate(s.date) : meet?.startDate;
    if (!swimDate) {
      warnings.push("A result without a date was skipped.");
      continue;
    }
    const timed = !s.dq && s.raceTime != null && s.raceTime > 0;
    results.push({
      externalId: s.id,
      meetExternalId: meet ? meetExternalId : null,
      swimDate,
      distance: s.distance,
      stroke,
      course,
      timeMs: timed ? s.raceTime! * 10 : null,
      place: s.place,
      heat: s.heat,
      lane: s.lane,
      stage: s.stage,
      dqReason: s.dq,
      splits: timed ? splitsFor(s.raceTime, splitsBySwim.get(s.id) ?? []) : [],
    });
  }

  // 6. Calendar: every meet and team event he's signed up for or invited to
  //    (SWM-2 "meets appear on the calendar"), as all-day events.
  const records: SourceRecord[] = [];
  const pushEvent = (
    externalId: string,
    title: string,
    startDate: string,
    endDate: string,
    answer: "yes" | "no" | null,
    notes: string[],
    location: string | null,
    sourceUrl: string,
  ) => {
    const { category, attendance } = categorise(title, ctx.source.mapping);
    if (answer === null) notes.unshift("Not signed up yet.");
    records.push({
      externalId,
      category,
      attendance: answer === "yes" ? attendance : "optional",
      title,
      notes: notes.length ? notes.join("\n").slice(0, 2000) : null,
      locationName: location,
      startUtc: new Date(`${startDate}T00:00:00Z`),
      endUtc: new Date(`${addDays(endDate, 1)}T00:00:00Z`),
      allDay: true,
      sourceUrl,
    });
  };
  for (const m of meets) {
    const entries = (m.entries ?? []).map(
      (e) => `${eventLabel(e)}${e.seedTimeMs ? ` (seed ${formatSwimTime(e.seedTimeMs)})` : ""}`,
    );
    pushEvent(
      m.externalId,
      m.name,
      m.startDate,
      m.endDate,
      m.externalId.startsWith("result:") ? "yes" : m.signup,
      entries.length ? [`Entered: ${entries.join(", ")}`] : [],
      [m.venue, m.city].filter(Boolean).join(", ") || null,
      m.sourceUrl ?? meetsUrl,
    );
  }
  for (const { s, startDate, endDate } of signups) {
    if (s.isMeet) continue;
    pushEvent(`signup:${s.id}`, s.title, startDate, endDate, s.answer, [], s.venue, meetsUrl);
  }

  const window = { from, to: null };
  return { records, window, warnings, swim: { meets, results, window } };
}
