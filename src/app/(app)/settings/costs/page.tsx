import { CostChart, money } from "@/components/costs/cost-chart";
import { CostsRefresh } from "@/components/costs/costs-refresh";
import { getDb } from "@/server/db";
import { loadCosts } from "@/server/costs";
import type { Budget } from "@/domain/costs";

const muted = "text-neutral-600 dark:text-neutral-400";
const tile = "flex flex-col gap-1 rounded-md border border-neutral-200 p-3 dark:border-neutral-800";

// What the hub costs (intent 0002, COST-1..5): from the Cloud Billing export,
// refreshed daily, plus the AI features' own estimates.
export default async function CostsPage() {
  const v = await loadCosts(await getDb());
  const s = v.summary;
  const c = v.currency;
  const f = v.features;
  const lastDay = s.latestDay ? Number(s.latestDay.slice(8, 10)) : null;
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Costs</h2>
        <CostsRefresh configured={v.configured} />
      </div>
      <p className={`text-sm ${muted}`}>
        {v.configured
          ? `From Google Cloud billing, net of credits, in ${c}. Billing data runs up to a day behind${
              s.latestDay ? `; the latest is for ${s.latestDay}` : ""
            }.${v.sync.lastRunAt ? ` Last read ${new Date(v.sync.lastRunAt).toLocaleString("en-CA")}.` : ""}`
          : "Google Cloud billing isn't connected yet, so only the AI estimates below are shown."}
      </p>
      {v.sync.lastError && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {v.sync.lastError}
        </p>
      )}
      {!v.configured && <ExportSteps />}

      {v.configured && (
        <>
          <section aria-label="This month" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={tile}>
              <span className={`text-sm ${muted}`}>This month so far</span>
              <span className="text-2xl font-semibold tabular-nums">{money(s.monthToDate.total, c)}</span>
              <span className={`text-sm ${muted}`}>
                Infrastructure {money(s.monthToDate.infra, c)} · AI {money(s.monthToDate.ai, c)}
              </span>
            </div>
            <div className={tile}>
              <span className={`text-sm ${muted}`}>Month-end estimate</span>
              {s.forecast ? (
                <>
                  <span className="text-2xl font-semibold tabular-nums">
                    {money(s.forecast.total.total, c)}
                  </span>
                  <span className={`text-sm ${muted}`}>
                    Likely {money(s.forecast.total.low, c)}–{money(s.forecast.total.high, c)}, from the last{" "}
                    {s.forecast.total.basisDays} days
                  </span>
                </>
              ) : (
                <span className={`text-sm ${muted}`}>Needs a few days of billing data.</span>
              )}
            </div>
            <div className={tile}>
              <span className={`text-sm ${muted}`}>Last month</span>
              {s.lastMonth ? (
                <>
                  <span className="text-2xl font-semibold tabular-nums">{money(s.lastMonth.total, c)}</span>
                  <span className={`text-sm ${muted}`}>
                    {money(s.lastMonth.toSameDay, c)} by day {lastDay} (this month:{" "}
                    {money(s.monthToDate.total, c)})
                  </span>
                </>
              ) : (
                <span className={`text-sm ${muted}`}>Shown once billing covers a whole month.</span>
              )}
            </div>
            <div className={tile}>
              <span className={`text-sm ${muted}`}>AI this month</span>
              <span className="text-2xl font-semibold tabular-nums">{money(s.monthToDate.ai, c)}</span>
              {s.forecast && (
                <span className={`text-sm ${muted}`}>
                  Estimate for the month {money(s.forecast.ai.total, c)}
                </span>
              )}
            </div>
          </section>

          {(s.budgets.project || s.budgets.ai) && (
            <section aria-labelledby="budgets" className="flex flex-col gap-2">
              <h3 id="budgets" className="font-medium">
                Budgets
              </h3>
              {s.budgets.project && <BudgetMeter name="Whole project" b={s.budgets.project} currency={c} />}
              {s.budgets.ai && <BudgetMeter name="AI" b={s.budgets.ai} currency={c} />}
            </section>
          )}

          <CostChart days={s.days} currency={c} />

          <section aria-labelledby="services" className="flex flex-col gap-2">
            <h3 id="services" className="font-medium">
              By service this month
            </h3>
            {s.services.length ? (
              <table className="w-full max-w-lg text-left text-sm">
                <tbody>
                  {s.services.map((x) => (
                    <tr key={x.service} className="border-t border-neutral-200 dark:border-neutral-800">
                      <td className="py-1 pr-3">
                        {x.service}
                        {x.ai && <span className={muted}> (AI)</span>}
                      </td>
                      <td className="py-1 text-right tabular-nums">{money(x.cost, c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className={`text-sm ${muted}`}>No charges this month yet.</p>
            )}
          </section>

          <details>
            <summary className="cursor-pointer text-sm">Every day as a table</summary>
            <div className="mt-2 max-h-96 overflow-y-auto">
              <table className="w-full max-w-lg text-left text-sm" aria-label="Daily cost">
                <thead className={muted}>
                  <tr>
                    <th className="py-1 pr-3 font-medium">Day</th>
                    <th className="py-1 pr-3 text-right font-medium">Infrastructure</th>
                    <th className="py-1 pr-3 text-right font-medium">AI</th>
                    <th className="py-1 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...s.days].reverse().map((d) => (
                    <tr
                      key={d.day}
                      className="border-t border-neutral-200 tabular-nums dark:border-neutral-800"
                    >
                      <td className="py-1 pr-3">{d.day}</td>
                      <td className="py-1 pr-3 text-right">{money(d.infra, c)}</td>
                      <td className="py-1 pr-3 text-right">{money(d.ai, c)}</td>
                      <td className="py-1 text-right">{money(d.total, c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <section aria-labelledby="features" className="flex flex-col gap-2">
        <h3 id="features" className="font-medium">
          AI by feature this month
        </h3>
        <table className="w-full max-w-lg text-left text-sm">
          <tbody>
            {(
              [
                ["Video reviews", f.month.video],
                ["Email suggestions", f.month.email],
                ["Match explanations", f.month.explanation],
              ] as const
            ).map(([name, cost]) => (
              <tr key={name} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="py-1 pr-3">{name}</td>
                <td className="py-1 text-right tabular-nums">{money(cost, "USD")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={`text-xs ${muted}`}>
          Estimates in US dollars from each call&apos;s tokens and list prices; the bill above is what Google
          charges.
        </p>
      </section>
    </main>
  );
}

function BudgetMeter({ name, b, currency }: { name: string; b: Budget; currency: string }) {
  const over = b.forecast !== null && b.forecast > b.amount;
  return (
    <div className="flex max-w-lg flex-col gap-1 text-sm">
      <div className="flex justify-between gap-2">
        <span>{name}</span>
        <span className="tabular-nums">
          {money(b.spent, currency)} of {money(b.amount, currency, 0)} ({b.percent}%)
        </span>
      </div>
      <meter
        className="h-3 w-full"
        min={0}
        max={b.amount}
        low={b.amount * 0.5}
        high={b.amount * 0.9}
        optimum={0}
        value={Math.min(b.spent, b.amount)}
        aria-label={`${name} budget used`}
      />
      {b.forecast !== null && (
        <span className={over ? "text-red-700 dark:text-red-400" : muted}>
          {over ? "⚠ " : ""}Month-end estimate {money(b.forecast, currency)}
          {over ? ", over budget" : ""}
        </span>
      )}
    </div>
  );
}

function ExportSteps() {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
      <p className="font-medium">To show the bill here, turn on the billing export once:</p>
      <ol className="list-decimal pl-5">
        <li>
          In BigQuery, create a dataset (e.g. &quot;billing&quot;) in the project, in a Canadian location.
        </li>
        <li>
          Google Cloud Console → Billing → Billing export → BigQuery export → Standard usage cost → Edit
          settings: choose the project and that dataset, and save.
        </li>
        <li>
          Set <code>billing_export_dataset</code> in the Terraform variables and run{" "}
          <code>terraform apply</code>. The table appears in the dataset within a day; then set{" "}
          <code>billing_export_table</code> too and apply again.
        </li>
      </ol>
    </section>
  );
}
