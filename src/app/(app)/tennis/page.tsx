import Link from "next/link";
import { eq } from "drizzle-orm";
import { sources } from "@db/schema";
import { RefreshButton } from "@/components/sport/refresh-button";
import { dates, DrawLine, muted, NextMatchLine, pct, PredictionBox } from "@/components/tennis/bits";
import { firstName, formatRecord } from "@/domain/tennis";
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
import { entrySections, tennisLastUpdated } from "@/server/tennis/overview";
import { upcomingRows, type UpcomingRow } from "@/server/tennis/upcoming";

// Tennis (TEN-2, TEN-3, TEN-6, TEN-9, TEN-10): his next matches with a
// prediction; tournaments in progress and the ones he's entered in;
// matching ones not open for entry yet and skipped ones (refreshed with
// every sync); past tournaments.
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
  const [explanations, entries, lastUpdated] = await Promise.all([
    explanationsFor(db, predictions),
    listEntries(db, data.today),
    tennisLastUpdated(db),
  ]);
  const sections = entrySections(entries, data.today);
  const name = firstName(data.self?.name);
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">🎾 Tennis</h1>
        <RefreshButton sourceIds={tc.map((s) => s.id)} site="Tennis Canada" what="tournaments and matches" />
      </div>
      <p className={`text-sm ${muted}`} data-testid="last-updated">
        Last updated: {lastUpdated ? updatedAt(lastUpdated, data.timeZone) : "not synced yet"}
      </p>
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
      <Upcoming
        rows={upcomingRows(data.tournaments, entries, data.today)}
        data={data}
        title={name ? `Tournaments ${name} is entered in` : "Tournaments he's entered in"}
      />
      <Entries entries={sections.found} />
      <NotOpen entries={sections.notOpen} />
      <Skipped entries={sections.skipped} />
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
function Upcoming({ rows, data, title }: { rows: UpcomingRow[]; data: TennisData; title: string }) {
  const th = "py-1 pr-3 font-medium";
  const td = "py-1.5 pr-3 align-top";
  return (
    <section aria-labelledby="upcoming" className="flex flex-col gap-2">
      <h2 id="upcoming" className="text-lg font-semibold">
        {title}
      </h2>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label={title}>
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
        <p className={`text-sm ${muted}`}>Not entered in any upcoming tournament.</p>
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

// "Wed Sept 30, 4:05 p.m." in the home time zone.
function updatedAt(iso: string, timeZone: string) {
  return new Date(iso).toLocaleString("en-CA", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const entryWindow = (e: EntryView) =>
  [e.entryOpens && `opens ${e.entryOpens}`, e.entryDeadline && `closes ${e.entryDeadline}`]
    .filter(Boolean)
    .join(" · ") || "—";

// Matching tournaments whose online entry hasn't opened yet; the Thursday
// job enters him once it does (TEN-9).
function NotOpen({ entries }: { entries: EntryView[] }) {
  const th = "py-1 pr-3 font-medium";
  const td = "py-1.5 pr-3 align-top";
  return (
    <section aria-labelledby="not-open" className="flex flex-col gap-2">
      <h2 id="not-open" className="text-lg font-semibold">
        Upcoming matching tournaments (not yet open)
      </h2>
      {entries.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Upcoming matching tournaments">
            <thead className={muted}>
              <tr>
                <th className={th}>Tournament</th>
                <th className={th}>Date</th>
                <th className={th}>Venue</th>
                <th className="py-1 font-medium">Entry</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  data-testid="not-open"
                  className="border-t border-neutral-200 dark:border-neutral-800"
                >
                  <td className={td}>
                    <a
                      href={e.tournamentUrl}
                      className="font-semibold underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {e.tournamentName}
                    </a>
                    {e.eventName && <div className={muted}>{e.eventName}</div>}
                  </td>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>{dates(e.startDate, e.endDate)}</td>
                  <td className={td}>
                    {[e.venue, e.city].filter(Boolean).join(", ") || "—"}
                    {e.driveMinutes !== null && <div className={muted}>{e.driveMinutes} min drive</div>}
                  </td>
                  <td className="py-1.5 align-top tabular-nums">{entryWindow(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={`text-sm ${muted}`}>None found yet.</p>
      )}
    </section>
  );
}

// Tournaments near home that don't fit him (wrong ball or age, too far, or
// the same weekend as one he's in), with why.
function Skipped({ entries }: { entries: EntryView[] }) {
  if (!entries.length) return null;
  return (
    <section aria-labelledby="skipped" className="flex flex-col gap-2">
      <h2 id="skipped" className="text-lg font-semibold">
        Skipped
      </h2>
      <ul className="flex flex-col gap-1 text-sm">
        {entries.map((e) => (
          <li key={e.id} data-testid="skipped">
            <a href={e.tournamentUrl} className="underline" target="_blank" rel="noreferrer">
              {e.tournamentName}
            </a>{" "}
            <span className="tabular-nums">({dates(e.startDate, e.endDate)})</span>
            {e.note && <span className={muted}> – {e.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
