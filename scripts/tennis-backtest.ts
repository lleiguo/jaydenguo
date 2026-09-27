// Plan M3.5 backtest: `DATABASE_URL=... pnpm exec tsx scripts/tennis-backtest.ts`
// replays every rated singles match in the database (see
// src/domain/tennis-predict.ts) and prints only aggregate calibration, so
// the output can go in a public PR without names or results.
import { createDb, createPool } from "../src/server/db/client";
import { loadCalibration } from "../src/server/tennis/load";

async function main() {
  const handle = await createPool();
  try {
    const bt = await loadCalibration(createDb(handle.pool));
    const pct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
    console.log(
      JSON.stringify(
        {
          matches: bt.n,
          favouriteWonPct: pct(bt.accuracy),
          brier: bt.brier && Number(bt.brier.toFixed(4)),
          brierRatingsOnly: bt.brierBase && Number(bt.brierBase.toFixed(4)),
          logLoss: bt.logLoss && Number(bt.logLoss.toFixed(4)),
          calibration: bt.buckets.map((b) => ({
            called: `${Math.round(b.from * 100)}-${Math.round(b.to * 100)}%`,
            matches: b.n,
            averageEstimatePct: b.n ? pct(b.predicted) : null,
            favouriteWonPct: b.n ? pct(b.actual) : null,
          })),
          byConfidence: bt.byConfidence.map((c) => ({
            ...c,
            accuracy: pct(c.accuracy),
            brier: c.brier && Number(c.brier.toFixed(4)),
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await handle.close();
  }
}
main();
