import Link from "next/link";
import { eq } from "drizzle-orm";
import { sources } from "@db/schema";
import { RefreshButton } from "@/components/sport/refresh-button";
import { dates, DrawLine, muted, NextMatchLine, pct, PredictionBox } from "@/components/tennis/bits";
import { formatRecord } from "@/domain/tennis";
import { ACTIVE_ENTRY } from "@/domain/tennis-entry";
import type { EntryStatus } from "@/domain/tennis-constants";
import { getDb } from "@/server/db";
import {
  listTournaments,
  predictAgainst,
  type PredictionView,
  type TennisData,
  type TournamentView,
} from "@/server/tennis/load";
import { explanationsFor } from "@/server/tennis/explain";
import { listEntries, type EntryView } from "@/server/tennis/entries";
import { upcomingRows, type UpcomingRow } from "@/server/tennis/upcoming";

// Tennis (TEN-2, TEN-3, TEN-6): his next matches with a prediction, and
// tournaments in progress, coming up and past.
export default async function TennisPage() {
  const db = await getDb();
  const [list, tc] = await Promise.all([
    listTournaments(db),
    db.select({ id: sources.id }).from(sources).where(eq(sources.kind, "tennis_tc")),
  ]);
  const { data, nextMatches, inProgress, past } = list;
  const predictions = nextMatches.map((n) =>
    n.draw.opponentKey ? predictAgainst(data, n.draw.opponentKey) : null,
  );
  const [explanations, entries] = await Promise.all([
    explanationsFor(db, predictions),
    listEntries(db, data.today),
  ]);
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
      <Upcoming rows={upcomingRows(data.tournaments, entries, data.today)} data={data} />
      <Entries entries={entries.filter((e) => !ACTIVE_ENTRY.includes(e.status as EntryStatus))} />
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

// TEN-2, TEN-10: every tournament he's registered for, before and after the
// acceptance list and the draw, with his next opponent and the prediction.
function Upcoming({ rows, data }: { rows: UpcomingRow[]; data: TennisData }) {
  const th = "py-1 pr-3 font-medium";
  const td = "py-1.5 pr-3 align-top";
  return (
    <section aria-labelledby="upcoming" className="flex flex-col gap-2">
      <h2 id="upcoming" className="text-lg font-semibold">
        Upcoming tournaments
      </h2>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Upcoming tournaments">
            <thead className={muted}>
              <tr>
                <th className={th}>Tournament</th>
                <th className={th}>Date</th>
                <th className={th}>Venue</th>
                <th className={th}>Status</th>
                <th className={th}>Opponent / time</th>
                <th className="py-1 font-medium">Prediction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const predictions = r.draws.map((d) =>
                  d.opponentKey ? predictAgainst(data, d.opponentKey) : null,
                );
                return (
                  <tr
                    key={r.key}
                    data-testid="upcoming-tournament"
                    data-status={r.status.kind}
                    className="border-t border-neutral-200 dark:border-neutral-800"
                  >
                    <td className={td}>
                      {r.tournamentId ? (
                        <Link
                          href={`/tennis/tournaments/${r.tournamentId}`}
                          className="font-semibold underline"
                        >
                          {r.name}
                        </Link>
                      ) : r.url ? (
                        <a href={r.url} className="font-semibold underline" target="_blank" rel="noreferrer">
                          {r.name}
                        </a>
                      ) : (
                        <span className="font-semibold">{r.name}</span>
                      )}
                      {r.events.length > 0 && <div className={muted}>{r.events.join(", ")}</div>}
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>
                      {dates(r.startDate, r.endDate)}
                    </td>
                    <td className={td}>
                      {r.venue ?? "—"}
                      {r.driveMinutes !== null && <div className={muted}>{r.driveMinutes} min drive</div>}
                    </td>
                    <td className={td}>
                      <span className="font-medium">{r.status.label}</span>
                      {r.status.action && (
                        <div>
                          <a
                            href={r.status.action.url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            {r.status.action.text} →
                          </a>
                        </div>
                      )}
                    </td>
                    <td className={td}>
                      {r.draws.length ? (
                        r.draws.map((d) => (
                          <div key={d.id}>
                            {r.draws.length > 1 && `${d.eventName ?? d.drawName ?? "Draw"}: `}
                            {d.next ? <NextMatchLine draw={d} /> : "Draw is out"}
                          </div>
                        ))
                      ) : (
                        <span className={muted}>
                          {r.status.kind === "withdrawn" ? "—" : "Draw not out yet"}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 align-top">
                      <Predictions list={predictions} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={`text-sm ${muted}`}>No upcoming tournaments.</p>
      )}
    </section>
  );
}

function Predictions({ list }: { list: (PredictionView | null)[] }) {
  const shown = list.filter((p): p is PredictionView => p !== null);
  if (!shown.length) return <span className={muted}>—</span>;
  return (
    <>
      {shown.map((p) => (
        <div key={p.opponentKey} data-testid="upcoming-prediction">
          <span className="font-semibold tabular-nums">{pct(p.probability)}</span> to win
          <span className={muted}> · confidence {p.confidence}</span>
        </div>
      ))}
    </>
  );
}

// TEN-9, TEN-10: tournaments found for him on Thursdays that he isn't
// registered for (those are under "Upcoming tournaments"). Anything the app
// couldn't finish links to the site for the owner.
function entryLine(e: EntryView): { text: string; action: string | null } {
  switch (e.status) {
    case "found":
      return { text: "Not entered yet", action: "Enter on the site" };
    case "withdrawn":
      return { text: "Not on the entry list any more", action: null };
    default:
      return { text: "Not entered", action: null };
  }
}

function Entries({ entries }: { entries: EntryView[] }) {
  if (!entries.length) return null;
  return (
    <section aria-labelledby="entries" className="flex flex-col gap-2">
      <h2 id="entries" className="text-lg font-semibold">
        Found for him
      </h2>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => {
          const { text, action } = entryLine(e);
          const needsYou = action !== null;
          return (
            <li
              key={e.id}
              data-testid="entry"
              data-status={e.status}
              className={`flex flex-col gap-1 rounded-lg border p-3 text-sm ${needsYou ? "border-amber-600" : "border-neutral-200 dark:border-neutral-800"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <a
                  href={e.tournamentUrl}
                  className="text-base font-semibold underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {e.tournamentName}
                </a>
                <span className="tabular-nums">{dates(e.startDate, e.endDate)}</span>
              </div>
              <div className={muted}>
                {e.eventName}
                {[e.venue, e.city].some(Boolean) && ` · ${[e.venue, e.city].filter(Boolean).join(", ")}`}
                {e.driveMinutes !== null && ` · ${e.driveMinutes} min drive`}
                {e.entryDeadline && ` · entries close ${e.entryDeadline}`}
              </div>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={needsYou ? "font-medium text-amber-800 dark:text-amber-300" : "font-medium"}>
                  {needsYou && "⚠ "}
                  {text}
                </span>
                {action && e.entryUrl && (
                  <a href={e.entryUrl} target="_blank" rel="noreferrer" className="underline">
                    {action} →
                  </a>
                )}
              </div>
              {e.note && <div className={muted}>{e.note}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
