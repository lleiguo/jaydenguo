import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressionChart } from "@/components/swim/progression-chart";
import { ResultsTable } from "@/components/swim/results-table";
import { eventLabel, formatSwimTime } from "@/domain/swim";
import { COURSE_LABEL } from "@/domain/swim-constants";
import { getDb } from "@/server/db";
import { loadEvent } from "@/server/swim/load";

// SWM-4, SWM-5: progression for one event and course, and the forecast.
export default async function EventPage({ params }: PageProps<"/swimming/events/[key]">) {
  const { key } = await params;
  const db = await getDb();
  const data = await loadEvent(db, key);
  if (!data) notFound();
  const { event, points, pbSteps, forecast, swims, today } = data;
  const label = eventLabel(event);
  const best = pbSteps.at(-1);
  return (
    <main className="flex flex-col gap-4">
      <Link href="/swimming" className="text-sm underline">
        ← Swimming
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{label}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {COURSE_LABEL[event.course]} only; other courses are never mixed in.
          {best && ` Best: ${formatSwimTime(best.timeMs)} on ${best.swimDate}.`}
        </p>
      </div>
      {points.length > 0 ? (
        <ProgressionChart
          points={points}
          pbSteps={pbSteps}
          forecast={forecast.status === "ok" ? forecast : null}
          today={today}
          label={label}
        />
      ) : (
        <p className="text-sm">No timed swims yet.</p>
      )}
      <section
        aria-labelledby="forecast"
        data-testid="forecast"
        className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
      >
        <h2 id="forecast" className="font-semibold">
          Estimate
        </h2>
        {forecast.status === "ok" ? (
          <>
            <ul>
              {forecast.points.map((p) => (
                <li key={p.months}>
                  In {p.months} months ({p.date}): about{" "}
                  <strong className="tabular-nums">{formatSwimTime(p.timeMs)}</strong>, likely between{" "}
                  <span className="tabular-nums">
                    {formatSwimTime(p.lowMs)} and {formatSwimTime(p.highMs)}
                  </span>
                  .
                </li>
              ))}
            </ul>
            <p className="text-neutral-600 dark:text-neutral-400">
              Fitted to his {forecast.swims} swims in this event, with improvement slowing over time. Children
              this age can improve in jumps (growth spurts, new technique), so treat this as a rough guide.
            </p>
          </>
        ) : (
          <p>No estimate yet: {forecast.reason}</p>
        )}
      </section>
      <section aria-labelledby="swims" className="flex flex-col gap-2">
        <h2 id="swims" className="font-semibold">
          Every swim
        </h2>
        <ResultsTable results={swims} show="event" />
      </section>
    </main>
  );
}
