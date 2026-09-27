import { CalendarApp } from "@/components/calendar/calendar-app";

// The combined calendar (spec CAL-1..9, CON-2..4).
export default async function CalendarPage({ searchParams }: PageProps<"/">) {
  const { view, date } = await searchParams;
  const allowed = ["timeGridDay", "timeGridWeek", "dayGridMonth", "listWeek"];
  return (
    <main className="flex flex-col gap-2">
      <h1 className="sr-only">Calendar</h1>
      <CalendarApp
        initialView={typeof view === "string" && allowed.includes(view) ? view : undefined}
        initialDate={typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined}
      />
    </main>
  );
}
