import { commitSwimAdapter } from "./commit-swim";
import { googleCalendarAdapter } from "./google-calendar";
import { icalAdapter } from "./ical";
import { schoolDatesAdapter } from "./school-dates";
import { tennisTcAdapter } from "./tennis-tc";
import type { Adapter } from "./types";

// One adapter per source kind (spec §3.4). Later milestones add theirs here.
export const adapters: Record<string, Adapter<never>> = {
  google_calendar: googleCalendarAdapter as Adapter<never>,
  ical: icalAdapter as Adapter<never>,
  commit_swim: commitSwimAdapter as Adapter<never>,
  tennis_tc: tennisTcAdapter as Adapter<never>,
  school_dates: schoolDatesAdapter as Adapter<never>,
};

export function adapterFor(kind: string): Adapter<unknown> {
  const adapter = Object.hasOwn(adapters, kind) ? adapters[kind] : undefined;
  if (!adapter) throw new Error(`No adapter for source kind ${kind}`);
  return adapter as Adapter<unknown>;
}
