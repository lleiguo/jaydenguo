import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { dates, DrawLine, muted, PredictionBox } from "@/components/tennis/bits";
import { EntryList } from "@/components/tennis/entry-list";
import { MatchesTable } from "@/components/tennis/matches-table";
import { formatRecord } from "@/domain/tennis";
import { getDb } from "@/server/db";
import { entriesForTournament } from "@/server/tennis/entry-list";
import { explanationsFor } from "@/server/tennis/explain";
import { loadTournament, predictAgainst } from "@/server/tennis/load";
import { externalHref } from "@/lib/external-href";

// TEN-2, TEN-3: one tournament, his draws with his next match, and his
// matches there.
export default async function TournamentPage({ params }: PageProps<"/tennis/tournaments/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getDb();
  const loaded = await loadTournament(db, id);
  if (!loaded) notFound();
  const { data, tournament: t, matches } = loaded;
  const predictions = t.draws.map((d) =>
    d.status === "active" && d.next?.status === "next" && d.opponentKey
      ? predictAgainst(data, d.opponentKey)
      : null,
  );
  const [explanations, entries] = await Promise.all([
    explanationsFor(db, predictions),
    t.when === "past" ? [] : entriesForTournament(db, t),
  ]);
  return (
    <main className="flex flex-col gap-4">
      <Link href="/tennis" className="text-sm underline">
        ← Tennis
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{t.name}</h1>
        <p className={`text-sm ${muted}`}>
          {[dates(t.startDate, t.endDate), t.venue, t.city, t.region].filter(Boolean).join(" · ")}
          {t.sourceUrl && (
            <>
              {" · "}
              <a href={externalHref(t.sourceUrl)} className="underline" rel="noreferrer" target="_blank">
                Open on the tournament site
              </a>
            </>
          )}
        </p>
        <p className="text-sm">
          {t.entryStatus}
          {t.entryDeadline && t.when === "upcoming" && ` · entry deadline ${t.entryDeadline}`}
          {t.record.wins + t.record.losses > 0 && ` · ${formatRecord(t.record)} here`}
        </p>
      </div>

      {t.draws.length > 0 && (
        <section aria-labelledby="draws" className="flex flex-col gap-3">
          <h2 id="draws" className="font-semibold">
            His draws
          </h2>
          {t.draws.map((d, i) => (
            <div key={d.id} className="flex flex-col gap-2 text-sm">
              <DrawLine draw={d} />
              {predictions[i] && data.self && (
                <PredictionBox
                  p={predictions[i]}
                  selfName={data.self.name}
                  explanation={explanations.get(predictions[i])}
                />
              )}
            </div>
          ))}
        </section>
      )}

      {entries.length > 0 && (
        <section aria-labelledby="acceptance" className="flex flex-col gap-3">
          <h2 id="acceptance" className="font-semibold">
            Acceptance list
          </h2>
          {entries.map((e) => (
            <EntryList key={e.id} entry={e} timeZone={data.timeZone} />
          ))}
        </section>
      )}

      <section aria-labelledby="matches" className="flex flex-col gap-2">
        <h2 id="matches" className="font-semibold">
          His matches
        </h2>
        <MatchesTable
          rows={matches}
          selfKeys={[...data.selfKeys]}
          timeZone={data.timeZone}
          show="tournament"
        />
      </section>
    </main>
  );
}
