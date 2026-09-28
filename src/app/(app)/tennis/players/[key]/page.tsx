import Link from "next/link";
import { notFound } from "next/navigation";
import { muted, NextMatchLine, PredictionBox, Players } from "@/components/tennis/bits";
import { MatchesTable } from "@/components/tennis/matches-table";
import { formatRecord } from "@/domain/tennis";
import { getDb } from "@/server/db";
import { explanationsFor } from "@/server/tennis/explain";
import { loadPlayer, predictAgainst } from "@/server/tennis/load";
import { externalHref } from "@/lib/external-href";

// TEN-4, TEN-5, TEN-6: an opponent, every meeting with him, their recent
// form, and the prediction for a match between them.
export default async function PlayerPage({ params }: PageProps<"/tennis/players/[key]">) {
  const { key } = await params;
  if (!/^[0-9a-f-]{1,40}$/i.test(key)) notFound();
  const db = await getDb();
  const loaded = await loadPlayer(db, key);
  if (!loaded) notFound();
  const { data, player, h2h, form, upcoming } = loaded;
  if (player.isSelf) notFound();
  const prediction = predictAgainst(data, key);
  const explanation = prediction ? (await explanationsFor(db, [prediction])).get(prediction) : null;
  const selfKeys = [...data.selfKeys];
  return (
    <main className="flex flex-col gap-4">
      <Link href="/tennis" className="text-sm underline">
        ← Tennis
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{player.name}</h1>
        <p className={`text-sm ${muted}`}>
          {player.club ?? "Club not shown"}
          {" · ranking not shown on the site"}
          {player.profileUrl && (
            <>
              {" · "}
              <a
                href={externalHref(player.profileUrl)}
                className="underline"
                rel="noreferrer"
                target="_blank"
              >
                Profile on the tournament site
              </a>
            </>
          )}
        </p>
      </div>

      {upcoming.map((u) => (
        <p key={u.draw.id} className="text-sm">
          <Link href={`/tennis/tournaments/${u.tournament.id}`} className="underline">
            {u.tournament.name}
          </Link>
          {" · "}
          <NextMatchLine draw={u.draw} />
        </p>
      ))}
      {prediction && data.self && (
        <section aria-labelledby="prediction" className="flex flex-col gap-2">
          <h2 id="prediction" className="font-semibold">
            If they play
          </h2>
          <PredictionBox p={prediction} selfName={data.self.name} explanation={explanation} />
        </section>
      )}

      <section aria-labelledby="h2h" className="flex flex-col gap-2">
        <h2 id="h2h" className="font-semibold">
          Head-to-head: <span data-testid="h2h-record">{formatRecord(h2h.record)}</span>
        </h2>
        {h2h.meetings.length ? (
          <MatchesTable rows={h2h.meetings} selfKeys={selfKeys} timeZone={data.timeZone} show="h2h" />
        ) : (
          <p className={`text-sm ${muted}`}>They haven&apos;t played each other in singles yet.</p>
        )}
      </section>

      <section aria-labelledby="form" className="flex flex-col gap-2">
        <h2 id="form" className="font-semibold">
          Form
        </h2>
        <p className="text-sm" data-testid="win-rate">
          Last 12 months: {formatRecord(form.lastYear)}
          {form.winRate !== null && ` (${Math.round(form.winRate * 100)}% won)`}
        </p>
        {form.last.length ? (
          <table className="w-full text-left text-sm" aria-label={`${player.name}'s last matches`}>
            <thead className={muted}>
              <tr>
                <th className="py-1 pr-3 font-medium">Date</th>
                <th className="py-1 pr-3 font-medium">Result</th>
                <th className="py-1 pr-3 font-medium">Score</th>
                <th className="py-1 font-medium">Opponent</th>
              </tr>
            </thead>
            <tbody>
              {form.last.map(({ match, view }) => (
                <tr
                  key={match.id}
                  data-testid="form-row"
                  className="border-t border-neutral-200 dark:border-neutral-800"
                >
                  <td className="py-1.5 pr-3 tabular-nums">{match.matchDate}</td>
                  <td className="py-1.5 pr-3 font-semibold">{view.result}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{view.score}</td>
                  <td className="py-1.5">
                    <Players players={view.opponents} selfKeys={selfKeys} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={`text-sm ${muted}`}>No results found for this player yet.</p>
        )}
      </section>
    </main>
  );
}
