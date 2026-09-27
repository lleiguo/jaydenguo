import { wallClock, zonedToUtc } from "@/domain/time";

// Times are shown in the home time zone (CAL-9), whatever the device's zone.

export function formatWhen(startIso: string, endIso: string, allDay: boolean, tz: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (allDay) {
    const f = new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const last = new Date(end.getTime() - 86_400_000);
    return last > start ? `${f.format(start)} – ${f.format(last)}` : f.format(start);
  }
  const day = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${day.format(start)}, ${time.format(start)} – ${time.format(end)}`;
}

// Values for <input type="date"> and <input type="time"> in the home zone.
export function toLocalInputs(iso: string, tz: string): { date: string; time: string } {
  const w = wallClock(new Date(iso), tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${w.year}-${p(w.month)}-${p(w.day)}`, time: `${p(w.hour)}:${p(w.minute)}` };
}

export function fromLocalInputs(date: string, time: string, tz: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time || "00:00").split(":").map(Number);
  return zonedToUtc({ year, month, day, hour, minute, second: 0 }, tz);
}
