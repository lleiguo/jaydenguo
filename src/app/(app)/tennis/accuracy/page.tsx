import Link from "next/link";
import { muted } from "@/components/tennis/bits";
import { getDb } from "@/server/db";
import { loadCalibration } from "@/server/tennis/load";

// "How accurate is this?" (TEN-6, spec §6.1): every decided singles match
// in the data set predicted from what was known the month before, grouped
// by how sure the prediction was.
export default async function AccuracyPage() {
  const db = await getDb();
  const bt = await loadCalibration(db);
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  return (
    <main className="flex flex-col gap-4">
      <Link href="/tennis" className="text-sm underline">
        ← Tennis
      </Link>
      <h1 className="text-xl font-semibold">How accurate are the predictions?</h1>
      <p className="text-sm">
        Each past match in the data (his and his opponents&apos;) was predicted using only the results from
        before its month, then checked against what happened. A well-calibrated estimate wins about as often
        as it says: matches called 70% should be won about 70% of the time.
      </p>
      {bt.n === 0 ? (
        <p className={`text-sm ${muted}`}>No rated matches yet.</p>
      ) : (
        <>
          <p className="text-sm" data-testid="accuracy-summary">
            {bt.n} matches · the favourite won {pct(bt.accuracy)} · Brier score {bt.brier?.toFixed(3)}{" "}
            (ratings alone {bt.brierBase?.toFixed(3)}; lower is better, 0.25 is a coin toss)
          </p>
          <table className="w-full text-left text-sm" aria-label="Calibration">
            <thead className={muted}>
              <tr>
                <th className="py-1 pr-3 font-medium">Called</th>
                <th className="py-1 pr-3 font-medium">Matches</th>
                <th className="py-1 pr-3 font-medium">Average estimate</th>
                <th className="py-1 font-medium">Favourite won</th>
              </tr>
            </thead>
            <tbody>
              {bt.buckets.map((b) => (
                <tr
                  key={b.from}
                  data-testid="calibration-row"
                  className="border-t border-neutral-200 dark:border-neutral-800"
                >
                  <td className="py-1.5 pr-3 tabular-nums">
                    {Math.round(b.from * 100)}–{Math.round(b.to * 100)}%
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{b.n}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{b.n ? pct(b.predicted) : "—"}</td>
                  <td className="py-1.5 tabular-nums">{b.n ? pct(b.actual) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-left text-sm" aria-label="By confidence">
            <thead className={muted}>
              <tr>
                <th className="py-1 pr-3 font-medium">Confidence</th>
                <th className="py-1 pr-3 font-medium">Matches</th>
                <th className="py-1 pr-3 font-medium">Favourite won</th>
                <th className="py-1 font-medium">Brier</th>
              </tr>
            </thead>
            <tbody>
              {bt.byConfidence.map((c) => (
                <tr key={c.confidence} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-1.5 pr-3">{c.confidence}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{c.n}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{pct(c.accuracy)}</td>
                  <td className="py-1.5 tabular-nums">{c.brier?.toFixed(3) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`text-sm ${muted}`}>
            Opponents new to the circuit have few results, so many predictions are &quot;low&quot; confidence
            early on.
          </p>
        </>
      )}
    </main>
  );
}
