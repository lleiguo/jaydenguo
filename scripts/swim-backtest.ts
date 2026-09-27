// Plan M2.6 backtest: `pnpm exec tsx scripts/swim-backtest.ts <results.csv>`
// with rows `date,distance,stroke,course,timeMs`. Prints only aggregate
// error figures, so the output can go in a public PR without his times.
import { readFileSync } from "node:fs";
import { backtest, type ForecastInput } from "../src/domain/swim-forecast";

const [file] = process.argv.slice(2);
if (!file) throw new Error("usage: swim-backtest.ts <results.csv>");
const events = new Map<string, ForecastInput>();
for (const line of readFileSync(file, "utf8").trim().split("\n").slice(1)) {
  const [date, distance, stroke, course, time] = line.split(",");
  const key = `${distance} ${stroke} ${course}`;
  events.set(key, [...(events.get(key) ?? []), { swimDate: date, timeMs: Number(time) }]);
}
const result = backtest(events);
const byEvent = new Map<string, number>();
for (const r of result.rows) byEvent.set(r.event, (byEvent.get(r.event) ?? 0) + 1);
console.log(
  JSON.stringify(
    {
      eventsWithBacktest: byEvent.size,
      predictions: result.rows.length,
      medianAbsErrorPct: result.medianAbsPct && Number(result.medianAbsPct.toFixed(2)),
      within90pctRange: result.coverage && Number(result.coverage.toFixed(2)),
      perEvent: Object.fromEntries(
        [...byEvent].map(([e, n]) => {
          const rows = result.rows.filter((r) => r.event === e);
          const errs = rows.map((r) => ((r.predictedMs - r.actualMs) / r.actualMs) * 100);
          return [
            e,
            { predictions: n, meanSignedErrorPct: Number((errs.reduce((a, b) => a + b, 0) / n).toFixed(2)) },
          ];
        }),
      ),
    },
    null,
    2,
  ),
);
