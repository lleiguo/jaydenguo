"use client";

import { useEffect, useState } from "react";
import { call } from "@/components/calendar/api";
import type { HouseholdMode, HouseholdSyncSettings, PlanLine, PlanSummary } from "@/server/household-sync";

type State = HouseholdSyncSettings & { sources: { id: string; name: string; canWrite: boolean }[] };

const muted = "text-sm text-neutral-600 dark:text-neutral-400";

const MODES: { mode: HouseholdMode; label: string }[] = [
  { mode: "off", label: "Off" },
  { mode: "dry_run", label: "Dry run" },
  { mode: "on", label: "On" },
];

const HEADINGS: [keyof PlanSummary, string][] = [
  ["create", "Add"],
  ["update", "Change"],
  ["link", "Match to an event already there"],
  ["remove", "Delete"],
  ["unlink", "Leave, no longer matched"],
];

const when = (l: PlanLine) => (l.start ? new Date(l.start).toLocaleString() : "");

// What a run would do or is waiting to do (TWO-9, TWSEC-2).
function PlanList({ plan, testId }: { plan: PlanSummary; testId: string }) {
  const parts = HEADINGS.filter(([k]) => plan[k].length);
  if (!parts.length)
    return <p data-testid={testId}>Nothing to change: the household calendar is up to date.</p>;
  return (
    <div data-testid={testId} className="flex flex-col gap-2">
      {parts.map(([k, heading]) => (
        <details key={k}>
          <summary>
            {heading}: {plan[k].length}
            {plan[k].length >= 50 && " or more"}
          </summary>
          <ul className="ml-4 list-disc">
            {plan[k].map((l, i) => (
              <li key={i}>
                {l.title} <span className={muted}>{when(l)}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

// Intent 0020: the hub writes its events into the household Google
// Calendar, so it holds everything once.
export function HouseholdSyncSetting() {
  const [s, setS] = useState<State | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/v1/household-sync");
      if (res.ok) setS((await res.json()) as State);
    };
    void load();
  }, [version]);
  if (!s) return null;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      setMessage(done);
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage((err as Error).message);
    }
  };
  const sourceId = s.sourceId ?? (s.sources.length === 1 ? s.sources[0].id : "");
  const source = s.sources.find((x) => x.id === sourceId);
  const setMode = (mode: HouseholdMode) => {
    if (mode === "on" && !confirm("Write the hub's events into the household calendar in Google?")) return;
    void act(
      () => call("/api/v1/household-sync", "PATCH", { mode, sourceId: sourceId || null }),
      mode === "off"
        ? "Off. Nothing more is written; what was written stays."
        : mode === "dry_run"
          ? "Dry run: the list below fills in about a minute. Nothing is written."
          : "On. The first run waits for you to check it below.",
    );
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className={muted}>
        Puts every event on the hub (tennis, swimming, soccer, school, events added here) into the household
        calendar in Google, with whose it is in the title, so that calendar alone shows everything once. Try
        Dry run first: it lists what would change without writing anything.
      </p>
      {s.sources.length === 0 ? (
        <p>Add the household Google calendar on the Sources page first.</p>
      ) : (
        <>
          {s.sources.length > 1 && (
            <label className="flex flex-col">
              Household calendar
              <select
                value={sourceId}
                onChange={(e) =>
                  act(
                    () => call("/api/v1/household-sync", "PATCH", { mode: "off", sourceId: e.target.value }),
                    "Calendar chosen. Two-way sync is off until you switch it on.",
                  )
                }
                className="rounded border px-2 py-1 dark:bg-neutral-900"
              >
                <option value="">Choose…</option>
                {s.sources.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div role="radiogroup" aria-label="Two-way sync" className="flex flex-wrap gap-2">
            {MODES.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={s.mode === mode}
                className={`rounded border px-3 py-1 ${s.mode === mode ? "bg-neutral-200 dark:bg-neutral-700" : ""}`}
                onClick={() => s.mode !== mode && setMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {source && !source.canWrite && (
            <p>
              To switch it on, press &quot;Let Cookie add events&quot; on the{" "}
              <a className="underline" href="/accounts">
                Accounts page
              </a>{" "}
              for the household calendar&apos;s Google account.
            </p>
          )}
          {s.mode === "dry_run" &&
            (s.dryRun ? (
              <>
                <p>What the next run would do ({new Date(s.dryRun.at).toLocaleString()}):</p>
                <PlanList plan={s.dryRun.plan} testId="household-dry-run" />
              </>
            ) : (
              <p className={muted}>Working out the list…</p>
            ))}
          {s.mode === "on" && s.held && (
            <div className="flex flex-col gap-2 rounded border border-amber-500 p-2">
              <p data-testid="household-held">{s.held.reason}</p>
              <PlanList plan={s.held.plan} testId="household-held-plan" />
              <div>
                <button
                  type="button"
                  className="rounded border px-3 py-1"
                  onClick={() =>
                    act(
                      () => call("/api/v1/household-sync/apply", "POST"),
                      "Applying. This takes a minute or two.",
                    )
                  }
                >
                  Apply
                </button>
              </div>
            </div>
          )}
          {s.mode === "on" && s.lastRunAt && (
            <p data-testid="household-status">
              Last run {new Date(s.lastRunAt).toLocaleString()}
              {s.last &&
                ` (${s.last.created} added, ${s.last.updated} changed, ${s.last.linked} matched, ${s.last.deleted} deleted)`}
              .
            </p>
          )}
          {s.lastError && <p className="text-red-700 dark:text-red-400">{s.lastError}</p>}
        </>
      )}
      <p aria-live="polite">{message}</p>
    </div>
  );
}
