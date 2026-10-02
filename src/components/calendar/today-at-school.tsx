import type { SchoolDay } from "@/server/calendar/school-day";

// "Today at school" (SCH-1): periods, classes, rooms and teachers from
// Veracross, each linking back to its Daily Schedule (SCH-5). One card per
// child, named once there's more than one.
export function TodayAtSchool({ days }: { days: SchoolDay[] }) {
  return days.map((day) => <SchoolDayCard key={day.person.id} day={day} named={days.length > 1} />);
}

function SchoolDayCard({ day, named }: { day: SchoolDay; named: boolean }) {
  const id = `today-at-school-${day.person.id}`;
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-CA", { timeZone: day.timeZone, hour: "numeric", minute: "2-digit" });
  const heading = day.today
    ? "Today at school"
    : `At school ${new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-CA", {
        timeZone: "UTC",
        weekday: "long",
        month: "short",
        day: "numeric",
      })}`;
  return (
    <section
      aria-labelledby={id}
      className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
    >
      <details open>
        <summary className="cursor-pointer">
          <h2 id={id} className="inline font-semibold">
            🏫 {named ? `${day.person.name}: ${heading}` : heading}
          </h2>{" "}
          <span className="text-neutral-600 dark:text-neutral-400">
            {time(day.periods[0].start)}–{time(day.periods.at(-1)!.end)}
          </span>
        </summary>
        <table className="mt-2 w-full text-left">
          <thead className="sr-only">
            <tr>
              <th>Time</th>
              <th>Class</th>
              <th>Room</th>
              <th>Teachers</th>
            </tr>
          </thead>
          <tbody>
            {day.periods.map((p) => (
              <tr key={p.id} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                <td className="py-1 pr-2 whitespace-nowrap">{time(p.start)}</td>
                <td className="py-1 pr-2">
                  {p.url ? (
                    <a className="underline" href={p.url} target="_blank" rel="noreferrer">
                      {p.title}
                    </a>
                  ) : (
                    p.title
                  )}
                </td>
                <td className="py-1 pr-2">{p.room}</td>
                <td className="py-1 text-neutral-600 dark:text-neutral-400">{p.teachers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
