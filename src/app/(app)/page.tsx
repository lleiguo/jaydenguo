import { CalendarApp } from "@/components/calendar/calendar-app";
import { TodayAtSchool } from "@/components/calendar/today-at-school";
import { loadSchoolDays } from "@/server/calendar/school-day";
import { getDb } from "@/server/db";

// The combined calendar (spec CAL-1..9, CON-2..4).
export default async function CalendarPage({ searchParams }: PageProps<"/">) {
  const { view, date } = await searchParams;
  const allowed = ["timeGridDay", "timeGridWeek", "dayGridMonth", "listWeek"];
  const schoolDays = await loadSchoolDays(await getDb());
  return (
    <main className="flex flex-col gap-2">
      <h1 className="sr-only">Calendar</h1>
      <TodayAtSchool days={schoolDays} />
      <CalendarApp
        initialView={typeof view === "string" && allowed.includes(view) ? view : undefined}
        initialDate={typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined}
      />
    </main>
  );
}
