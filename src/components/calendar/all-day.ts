// A dropped all-day event, back to UTC midnights of its dates (the stored
// form). The calendar's own dates are its dates in the home zone.
type Dates = { startStr: string; endStr: string };
export function allDayMove(event: Dates, old: Dates) {
  const day = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
  const start = day(event.startStr);
  const days = old.endStr ? Math.max(1, Math.round((day(old.endStr) - day(old.startStr)) / 86_400_000)) : 1;
  const end = event.endStr ? day(event.endStr) : start + days * 86_400_000;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
