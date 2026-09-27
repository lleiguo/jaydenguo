import Link from "next/link";
import { eq } from "drizzle-orm";
import { sources } from "@db/schema";
import { AddResultForm } from "@/components/swim/add-result-form";
import { RefreshButton } from "@/components/sport/refresh-button";
import { eventLabel, formatSwimTime } from "@/domain/swim";
import { COURSE_LABEL } from "@/domain/swim-constants";
import { getDb } from "@/server/db";
import { listMeets, loadPersonalBests, type MeetView } from "@/server/swim/load";

// Swimming (SWM-2, SWM-6): upcoming and past meets, and the PB table.
export default async function SwimmingPage() {
  const db = await getDb();
  const [{ today, upcoming, past }, pbs, commit] = await Promise.all([
    listMeets(db),
    loadPersonalBests(db),
    db.select({ id: sources.id }).from(sources).where(eq(sources.kind, "commit_swim")),
  ]);
  const courses = [...new Set(pbs.map((p) => p.course))];
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">🏊 Swimming</h1>
        <RefreshButton sourceIds={commit.map((s) => s.id)} site="Commit Swimming" what="meets and results" />
      </div>

      <section aria-labelledby="upcoming" className="flex flex-col gap-2">
        <h2 id="upcoming" className="text-lg font-semibold">
          Upcoming meets
        </h2>
        {upcoming.length ? (
          <ul className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <MeetCard key={m.id} m={m} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">No upcoming meets.</p>
        )}
      </section>

      <section aria-labelledby="pbs" className="flex flex-col gap-2">
        <h2 id="pbs" className="text-lg font-semibold">
          Personal bests
        </h2>
        {!pbs.length && <p className="text-sm text-neutral-600 dark:text-neutral-400">No results yet.</p>}
        {courses.map((course) => (
          <div key={course} className="overflow-x-auto">
            <table
              className="w-full text-left text-sm"
              aria-label={`Personal bests, ${COURSE_LABEL[course]}`}
            >
              <caption className="py-1 text-left font-medium">{COURSE_LABEL[course]}</caption>
              <thead className="text-neutral-600 dark:text-neutral-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">Event</th>
                  <th className="py-1 pr-3 font-medium">Best</th>
                  <th className="py-1 pr-3 font-medium">Date</th>
                  <th className="py-1 pr-3 font-medium">Meet</th>
                  <th className="py-1 font-medium">Swims</th>
                </tr>
              </thead>
              <tbody>
                {pbs
                  .filter((p) => p.course === course)
                  .map((p) => (
                    <tr
                      key={p.key}
                      data-testid="pb-row"
                      className="border-t border-neutral-200 dark:border-neutral-800"
                    >
                      <td className="py-1.5 pr-3">
                        <Link href={`/swimming/events/${p.key}`} className="underline">
                          {eventLabel(p, false)}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 font-semibold tabular-nums">{formatSwimTime(p.timeMs)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{p.swimDate}</td>
                      <td className="py-1.5 pr-3">
                        {p.meetId ? (
                          <Link href={`/swimming/meets/${p.meetId}`} className="underline">
                            {p.meetName}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-1.5 tabular-nums">{p.swims}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <AddResultForm
        today={today}
        meets={[...upcoming, ...past].map((m) => ({
          id: m.id,
          name: m.name,
          startDate: m.startDate,
          course: m.course,
        }))}
      />

      <section aria-labelledby="past" className="flex flex-col gap-2">
        <h2 id="past" className="text-lg font-semibold">
          Past meets
        </h2>
        {past.length ? (
          <ul className="flex flex-col gap-2">
            {past.map((m) => (
              <MeetCard key={m.id} m={m} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">No past meets.</p>
        )}
      </section>
    </main>
  );
}

function MeetCard({ m }: { m: MeetView }) {
  const dates = m.endDate !== m.startDate ? `${m.startDate} – ${m.endDate}` : m.startDate;
  return (
    <li
      data-testid="meet"
      className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/swimming/meets/${m.id}`} className="text-base font-semibold underline">
          {m.name}
        </Link>
        <span className="tabular-nums">{dates}</span>
      </div>
      <div className="text-neutral-600 dark:text-neutral-400">
        {[m.course, m.venue, m.city].filter(Boolean).join(" · ")}
        {m.signup === null && !m.manual && " · not signed up yet"}
      </div>
      {m.entries.length > 0 && m.swims === 0 && (
        <div>
          Entered:{" "}
          {m.entries
            .map(
              (e) =>
                `${eventLabel(e, false)}${e.seedTimeMs ? ` (seed ${formatSwimTime(e.seedTimeMs)})` : ""}`,
            )
            .join(", ")}
        </div>
      )}
      {m.swims > 0 && (
        <div>
          {m.swims} swim{m.swims === 1 ? "" : "s"}
          {m.pbs > 0 && ` · ★ ${m.pbs} PB${m.pbs === 1 ? "" : "s"}`}
        </div>
      )}
    </li>
  );
}
