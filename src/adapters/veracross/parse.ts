import { parse } from "node-html-parser";

// Veracross parent portal pages (spikes.md SP-4, "Veracross Daily Schedule
// page map"). Only whitelisted fields are read: the rotation day and, per
// period, its start time, class or block name, teachers and room.

export type VcPeriod = {
  // "HH:MM", 24-hour, in the school's (home) time zone.
  start: string;
  description: string;
  teachers: string[];
  room: string | null;
  // Recess, lunch and other whole-school blocks.
  block: boolean;
};
export type VcDay = { date: string; rotation: string | null; periods: VcPeriod[] };

const clean = (s: string) =>
  s
    .replace(/&nbsp;| /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

export function to24h(time: string): string | null {
  const m = clean(time).match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

// "Teacher One, Teacher Two • R101" → teachers and room. Either side may be
// missing.
function splitSubtitle(subtitle: string): { teachers: string[]; room: string | null } {
  const [who, where] = subtitle.includes("•") ? subtitle.split("•") : [subtitle, ""];
  return {
    teachers: clean(who)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    room: clean(where) || null,
  };
}

export function parseDailySchedule(html: string, date: string): VcDay {
  const root = parse(html);
  if (!root.querySelector(".daily-schedule")) throw new Error("not a daily schedule page");
  const rotation = clean(root.querySelector(".rotation-day-header")?.text ?? "") || null;
  const periods: VcPeriod[] = [];
  for (const item of root.querySelectorAll(".vx-schedule-item")) {
    const start = to24h(item.querySelector(".item-time")?.text ?? "");
    const description = clean(item.querySelector(".item-main-description")?.text ?? "");
    if (!start || !description) continue;
    periods.push({
      start,
      description: description.slice(0, 200),
      ...splitSubtitle(item.querySelector(".item-subtitle")?.text ?? ""),
      block: !!item.querySelector(".item-type.universal-block"),
    });
  }
  return { date, rotation, periods };
}
