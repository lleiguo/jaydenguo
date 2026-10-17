import { addDays, weekday, zonedToUtc } from "./time";

// The rules for the few things Cookie may change (intent 0008): an event a
// parent describes, and email suggestions a parent asks her to apply.
// Pure, so they are unit-tested without a database or a model.

export const ACTION_KINDS = ["add_event", "apply_suggestion"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

// pending: in the hub, not yet in Google. done: in both. failed: Google
// refused, the hub's event is gone. undone: taken back by the parent.
export const ACTION_STATES = ["pending", "done", "failed", "undone"] as const;
export type ActionState = (typeof ACTION_STATES)[number];

// GCW-3: the narrowest Google permission that can add to the household
// calendar: events on calendars the account owns (plan SP-E1).
export const ADD_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";

export const CHANGE_LIMITS = {
  // CASEC-5: across the family.
  perDay: 20,
  // ACT-3
  undoMinutes: 10,
  // ADD-4: further ahead than this is asked about.
  aheadDays: 550,
  // ADD-5: a timed event with no end.
  defaultMinutes: 60,
  titleChars: 120,
  // EMS-2: pending suggestions she is shown; EMS-4: applied in one go.
  listed: 10,
  batch: 5,
} as const;

// ADD-2: she adds an event only when the question itself asks her to, so
// text in an email, an event or a web page can never start it.
const ADD =
  /\b(add|put|schedule|book|create|set up)\b|添加|新增|安排|预约|预订|记到|放到|加(一?个|上|到|进)|约(一?个|了)/i;
export const asksToAdd = (question: string) => ADD.test(question);

// EMS-3, EMS-4: the same, for applying email suggestions, which a parent
// may also ask for as "approve", "accept" or "update my calendar".
const APPLY = /\b(apply|approve|accept|update)\b|更新|同意|批准|采纳|应用|确认/i;
export const asksToApply = (question: string) => ADD.test(question) || APPLY.test(question);

// What applying a suggestion did to the calendar.
export type AppliedKind = "added" | "moved" | "cancelled";
export const appliedKind = (kind: string): AppliedKind =>
  kind === "change" ? "moved" : kind === "cancel" ? "cancelled" : "added";

type Sure = "high" | "medium" | "low";

// EMS-4: why a suggestion from today's email is left for the parent rather
// than applied in a batch; null when it can be applied.
export function leftBecause(s: {
  kind: string;
  date: string | null;
  targetEventId: string | null;
  confidence: Record<string, Sure>;
}): string | null {
  const unsure = unsureFields(s.confidence);
  if (unsure.length) return `not sure of the ${unsure.join(" and ")}`;
  if (s.kind === "new" && !s.date) return "no date";
  if (s.kind !== "new" && !s.targetEventId) return "the event it's about isn't on the calendar";
  return null;
}

// The fields a suggestion isn't sure of, to say when it is applied (EMS-3).
export const unsureFields = (confidence: Record<string, Sure>) =>
  Object.entries(confidence)
    .filter(([field, sure]) => field !== "overall" && sure === "low")
    .map(([field]) => field);

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DAY_WORDS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  周日: 0,
  星期日: 0,
  星期天: 0,
  礼拜天: 0,
  周一: 1,
  星期一: 1,
  周二: 2,
  星期二: 2,
  周三: 3,
  星期三: 3,
  周四: 4,
  星期四: 4,
  周五: 5,
  星期五: 5,
  周六: 6,
  星期六: 6,
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const isDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

// "Thursday, December 3, 2026": how she says a day back (ADD-7).
export function dayInWords(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${DAY_NAMES[weekday(date)]}, ${MONTHS[month - 1]} ${day}, ${year}`;
}

// ADD-4: the day is checked, not trusted. Returns what to ask the parent,
// or null when the day stands. `said` is the weekday as it was spoken.
export function dayProblem(date: string, said: string | null | undefined, today: string): string | null {
  if (!isDate(date)) return "that isn't a date; ask which day";
  if (said?.trim()) {
    const wanted = DAY_WORDS[said.trim().toLowerCase().replace(/\.$/, "")];
    if (wanted === undefined) return `"${said}" isn't a weekday; ask which day`;
    if (wanted !== weekday(date))
      return `${dayInWords(date)} is a ${DAY_NAMES[weekday(date)]}, not a ${DAY_NAMES[wanted]}; ask which was meant and add nothing`;
  }
  if (date < today) return `${dayInWords(date)} has passed; ask which day was meant`;
  if (date > addDays(today, CHANGE_LIMITS.aheadDays))
    return `${dayInWords(date)} is more than 18 months away; ask if that is right`;
  return null;
}

export type EventTimes = { start: Date; end: Date; allDay: boolean };

const clock = (hhmm: string) => {
  const m = hhmm.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
};

// ADD-5: a start time makes a timed event, an hour long unless an end was
// said; "all day" an all-day one; neither is asked about. All-day events
// are stored the way the calendar stores them: midnight UTC of the day.
export function eventTimes(
  when: { date: string; start?: string | null; end?: string | null; allDay?: boolean | null },
  timeZone: string,
): EventTimes | { problem: string } {
  if (when.allDay && !when.start) {
    const start = new Date(`${when.date}T00:00:00Z`);
    return { start, end: new Date(start.getTime() + 86_400_000), allDay: true };
  }
  if (!when.start) return { problem: "no time was given; ask what time, or whether it is all day" };
  const from = clock(when.start);
  if (!from) return { problem: "the start time isn't a time; use HH:MM in 24-hour time" };
  const [year, month, day] = when.date.split("-").map(Number);
  const start = zonedToUtc({ year, month, day, ...from, second: 0 }, timeZone);
  let end = new Date(start.getTime() + CHANGE_LIMITS.defaultMinutes * 60_000);
  if (when.end) {
    const to = clock(when.end);
    if (!to) return { problem: "the end time isn't a time; use HH:MM in 24-hour time" };
    const said = zonedToUtc({ year, month, day, ...to, second: 0 }, timeZone);
    if (said <= start) return { problem: "the end is before the start; ask what time it ends" };
    end = said;
  }
  return { start, end, allDay: false };
}

// ADD-5: "all day" must be in the parent's words; the model saying so
// isn't enough (a haircut with no time isn't all day).
const ALL_DAY = /\ball[- ]day\b|\bwhole day\b|全天|一整天|整天/i;
export const saysAllDay = (question: string) => ALL_DAY.test(question);

const EVERYONE = /^(everyone|everybody|all|family|the family|whole family|大家|全家|所有人)$/i;

// Intent 0019, SHA-3: the parent's own words say it's for everyone.
const SAYS_EVERYONE =
  /\b(everyone|everybody|all of us|the (whole )?family|both (boys|kids))\b|大家|全家|所有人|两个孩子/i;
export const saysEveryone = (question: string) => SAYS_EVERYONE.test(question);

export type Who = { everyone: boolean; ids: string[]; names: string[] };

// ADD-3: whose event it is. Every name must be one of People; "everyone"
// means the whole family. With nobody named she asks.
export function whoIsIt(
  named: readonly string[],
  people: readonly { id: string; name: string }[],
): Who | { problem: string } {
  const names = named.map((n) => n.trim()).filter(Boolean);
  if (!names.length) return { problem: "no person was named; ask whose event it is and add nothing" };
  if (names.some((n) => EVERYONE.test(n)))
    return { everyone: true, ids: people.map((p) => p.id), names: people.map((p) => p.name) };
  const found: { id: string; name: string }[] = [];
  for (const name of names) {
    const person = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!person)
      return {
        problem: `no one called ${name}; people are ${people.map((p) => p.name).join(", ")}. Ask who was meant`,
      };
    if (!found.includes(person)) found.push(person);
  }
  return { everyone: false, ids: found.map((p) => p.id), names: found.map((p) => p.name) };
}

const named = (title: string, name: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(title);

// GCW-6: Google has no owner field, so the title carries the names the
// hub reads owners from ("Jayden dentist", "Jayden & Lei dentist"). An
// event for everyone has no name in front.
export function titleWithNames(title: string, who: Who): string {
  const plain = title.trim().replace(/\s+/g, " ").slice(0, CHANGE_LIMITS.titleChars);
  if (who.everyone) return plain;
  const missing = who.names.filter((n) => !named(plain, n));
  return missing.length ? `${missing.join(" & ")} ${plain}` : plain;
}

// The same for email suggestions she applied (EMS-3, EMS-4).
export function appliedLine(
  language: string | null | undefined,
  applied: { title: string; kind: AppliedKind }[],
) {
  const zh = language === "zh" || language === "mixed";
  const words = zh
    ? { added: "已添加", moved: "已改时间", cancelled: "已取消" }
    : { added: "added", moved: "moved", cancelled: "cancelled" };
  const parts = applied.map((a) => (zh ? `${words[a.kind]}：${a.title}` : `${a.title} ${words[a.kind]}`));
  return zh ? `按邮件建议，${parts.join("；")}。` : `From the email suggestions: ${parts.join("; ")}.`;
}

// The line the server says itself when the model's own ending can't
// stand but an event was added (ADD-7).
export function addingLine(
  language: string | null | undefined,
  event: { title: string; date: string; start: string | null; names: string[]; everyone: boolean },
): string {
  const zh = language === "zh" || language === "mixed";
  const time = event.start ?? (zh ? "全天" : "all day");
  const who = event.everyone ? (zh ? "全家" : "everyone") : event.names.join(zh ? "、" : " and ");
  return zh
    ? `正在添加：${event.title}，${event.date} ${time}，${who}。`
    : `Adding: ${event.title}, ${dayInWords(event.date)}, ${time}, for ${who}.`;
}
