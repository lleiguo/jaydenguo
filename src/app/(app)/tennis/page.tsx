import Link from "next/link";
import { eq } from "drizzle-orm";
import { sources } from "@db/schema";
import { RefreshButton } from "@/components/sport/refresh-button";
import { dates, DrawLine, muted, PredictionBox } from "@/components/tennis/bits";
import { formatRecord } from "@/domain/tennis";
import { getDb } from "@/server/db";
import { listTournaments, predictAgainst, type TournamentView } from "@/server/tennis/load";
import { explanationsFor } from "@/server/tennis/explain";

// Tennis (TEN-2, TEN-3, TEN-6): his next matches with a prediction, and
// tournaments in progress, coming up and past.
export default async function TennisPage() {
  const db = await getDb();
  const [list, tc] = await Promise.all([
    listTournaments(db),
    db.select({ id: sources.id }).from(sources).where(eq(sources.kind, "tennis_tc")),
  ]);
  const { data, nextMatches, inProgress, upcoming, past } = list;
  const predictions = nextMatches.map((n) =>
    n.draw.opponentKey ? predictAgainst(data, n.draw.opponentKey) : null,
  );
  const explanations = await explanationsFor(db, predictions);
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">🎾 Tennis</h1>
        <RefreshButton sourceIds={tc.map((s) => s.id)} site="Tennis Canada" what="tournaments and matches" />
      </div>
      <nav className="flex flex-wrap gap-3 text-sm">
        <Link href="/tennis/results" className="underline">
          Results and W–L
        </Link>
        <Link href="/tennis/accuracy" className="underline">
          How accurate are the predictions?
        </Link>
      </nav>

      {nextMatches.length > 0 && (
        <section aria-labelledby="next" className="flex flex-col gap-2">
          <h2 id="next" className="text-lg font-semibold">
            Next matches
          </h2>
          <ul className="flex flex-col gap-3">
            {nextMatches.map((n, i) => (
              <li
                key={n.draw.id}
                data-testid="next-match"
                className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <Link href={`/tennis/tournaments/${n.tournament.id}`} className="font-semibold underline">
                  {n.tournament.name}
                </Link>
                <DrawLine draw={n.draw} />
                {predictions[i] && data.self && (
                  <PredictionBox
                    p={predictions[i]}
                    selfName={data.self.name}
                    explanation={explanations.get(predictions[i])}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <TournamentList id="in-progress" title="In progress" list={inProgress} empty={null} />
      <TournamentList
        id="upcoming"
        title="Upcoming tournaments"
        list={upcoming}
        empty="No upcoming tournaments."
      />
      <TournamentList id="past" title="Past tournaments" list={past} empty="No past tournaments." />
    </main>
  );
}

function TournamentList({
  id,
  title,
  list,
  empty,
}: {
  id: string;
  title: string;
  list: TournamentView[];
  empty: string | null;
}) {
  if (!list.length && empty === null) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {list.length ? (
        <ul className="flex flex-col gap-2">
          {list.map((t) => (
            <TournamentCard key={t.id} t={t} />
          ))}
        </ul>
      ) : (
        <p className={`text-sm ${muted}`}>{empty}</p>
      )}
    </section>
  );
}

function TournamentCard({ t }: { t: TournamentView }) {
  const played = t.record.wins + t.record.losses;
  return (
    <li
      data-testid="tournament"
      className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/tennis/tournaments/${t.id}`} className="text-base font-semibold underline">
          {t.name}
        </Link>
        <span className="tabular-nums">{dates(t.startDate, t.endDate)}</span>
      </div>
      <div className={muted}>
        {[t.venue, t.city].filter(Boolean).join(", ")}
        {(t.venue || t.city) && " · "}
        {t.entryStatus}
        {played > 0 && ` · ${formatRecord(t.record)}`}
      </div>
      {t.events.length > 0 && <div>{t.events.join(", ")}</div>}
    </li>
  );
}
