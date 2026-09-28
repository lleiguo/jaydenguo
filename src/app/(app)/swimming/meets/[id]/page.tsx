import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AddResultForm } from "@/components/swim/add-result-form";
import { ResultsTable } from "@/components/swim/results-table";
import { eventLabel, formatSession, formatSwimTime } from "@/domain/swim";
import { getDb } from "@/server/db";
import { loadMeet } from "@/server/swim/load";
import { localDate } from "@/domain/time";
import { getHomeTimeZone } from "@/server/settings";
import { externalHref } from "@/lib/external-href";

// SWM-2, SWM-3: one meet, its entries with seed times, and its swims.
export default async function MeetPage({ params }: PageProps<"/swimming/meets/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getDb();
  const data = await loadMeet(db, id);
  if (!data) notFound();
  const { meet, results } = data;
  const today = localDate(new Date(), await getHomeTimeZone(db));
  const dates = meet.endDate !== meet.startDate ? `${meet.startDate} – ${meet.endDate}` : meet.startDate;
  return (
    <main className="flex flex-col gap-4">
      <Link href="/swimming" className="text-sm underline">
        ← Swimming
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{meet.name}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {[dates, meet.course, meet.venue, meet.city].filter(Boolean).join(" · ")}
          {meet.sourceUrl && (
            <>
              {" · "}
              <a href={externalHref(meet.sourceUrl)} className="underline" rel="noreferrer" target="_blank">
                Open in Commit Swimming
              </a>
            </>
          )}
        </p>
      </div>
      {meet.entries.length > 0 && (
        <section aria-labelledby="entries" className="flex flex-col gap-1">
          <h2 id="entries" className="font-semibold">
            Entered events
          </h2>
          <ul className="text-sm">
            {meet.entries.map((e) => (
              <li key={e.key}>
                {eventLabel(e)}
                {e.seedTimeMs ? ` · seed ${formatSwimTime(e.seedTimeMs)}` : " · no seed time"}
                {e.session && ` · session ${formatSession(e.session)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="results" className="flex flex-col gap-2">
        <h2 id="results" className="font-semibold">
          Results
        </h2>
        <ResultsTable results={results} show="meet" />
      </section>
      <AddResultForm
        today={today}
        meetId={meet.id}
        meets={[{ id: meet.id, name: meet.name, startDate: meet.startDate, course: meet.course }]}
      />
    </main>
  );
}
