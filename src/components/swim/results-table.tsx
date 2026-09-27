"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/components/calendar/api";
import { eventLabel, formatChange, formatSwimTime } from "@/domain/swim";
import type { ResultView } from "@/server/swim/load";

// Swims with PB flag and change from the previous best (SWM-3), and the
// owner's corrections (SWM-7): edit, delete, or go back to the source's time.

type Props = { results: ResultView[]; show: "meet" | "event" };

export function ResultsTable({ results, show }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const act = async (p: Promise<unknown>, done: string) => {
    try {
      await p;
      setMessage(done);
      setEditing(null);
      router.refresh();
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  if (!results.length) return <p className="text-sm text-neutral-600 dark:text-neutral-400">No swims yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-600 dark:text-neutral-400">
            <tr>
              <th className="py-1 pr-3 font-medium">{show === "meet" ? "Event" : "Date"}</th>
              {show === "event" && <th className="py-1 pr-3 font-medium">Meet</th>}
              <th className="py-1 pr-3 font-medium">Time</th>
              <th className="py-1 pr-3 font-medium">vs best before</th>
              <th className="py-1 pr-3 font-medium">Place</th>
              <th className="py-1 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <ResultRow
                key={r.id}
                r={r}
                show={show}
                editing={editing === r.id}
                onEdit={() => setEditing(editing === r.id ? null : r.id)}
                act={act}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultRow({
  r,
  show,
  editing,
  onEdit,
  act,
}: {
  r: ResultView;
  show: Props["show"];
  editing: boolean;
  onEdit: () => void;
  act: (p: Promise<unknown>, done: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const label = eventLabel(r);
  // Running distance and time at the end of each leg.
  const legs = r.splits.reduce<{ metres: number; total: number; ms: number }[]>((out, s) => {
    const prev = out.at(-1);
    return [...out, { metres: (prev?.metres ?? 0) + s.distance, total: (prev?.total ?? 0) + s.ms, ms: s.ms }];
  }, []);
  return (
    <>
      <tr data-testid="swim-result" className="border-t border-neutral-200 align-top dark:border-neutral-800">
        <td className="py-2 pr-3">
          {show === "meet" ? (
            <Link href={`/swimming/events/${r.key}`} className="underline">
              {label}
            </Link>
          ) : (
            r.swimDate
          )}
          {r.stage && r.stage !== "Final" && <span className="text-neutral-500"> · {r.stage}</span>}
        </td>
        {show === "event" && (
          <td className="py-2 pr-3">
            {r.meetId ? (
              <Link href={`/swimming/meets/${r.meetId}`} className="underline">
                {r.meetName}
              </Link>
            ) : (
              "—"
            )}
          </td>
        )}
        <td className="py-2 pr-3">
          <span className="font-semibold tabular-nums">{r.dqReason ? "DQ" : formatSwimTime(r.timeMs)}</span>
          {r.isPb && (
            <span
              className="ml-2 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100"
              aria-label="personal best"
            >
              ★ PB
            </span>
          )}
          {r.dqReason && <div className="text-xs text-neutral-600 dark:text-neutral-400">{r.dqReason}</div>}
          {r.corrected && (
            <div className="text-xs text-neutral-600 dark:text-neutral-400">✎ Corrected by you</div>
          )}
          {r.origin === "manual" && !r.corrected && (
            <div className="text-xs text-neutral-600 dark:text-neutral-400">✎ Added by you</div>
          )}
          {r.sourceDisagrees && (
            <div
              data-testid="source-disagrees"
              className="text-xs font-medium text-red-700 dark:text-red-400"
            >
              ⚠{" "}
              {r.source
                ? `Commit Swimming says ${r.source.dqReason ? "DQ" : formatSwimTime(r.source.timeMs)}`
                : "Commit Swimming no longer lists this swim"}
            </div>
          )}
          {r.splits.length > 0 && (
            <details className="text-xs text-neutral-600 dark:text-neutral-400">
              <summary className="cursor-pointer">Splits</summary>
              <ol className="tabular-nums">
                {legs.map((l) => (
                  <li key={l.metres}>
                    {l.metres} m: {formatSwimTime(l.total)} ({formatSwimTime(l.ms)})
                  </li>
                ))}
              </ol>
            </details>
          )}
        </td>
        <td className="py-2 pr-3 tabular-nums">
          {r.changeMs === null ? (
            r.timeMs !== null ? (
              <span className="text-neutral-500">first swim</span>
            ) : (
              "—"
            )
          ) : (
            <span className={r.changeMs < 0 ? "text-green-800 dark:text-green-400" : ""}>
              {formatChange(r.changeMs)}
            </span>
          )}
        </td>
        <td className="py-2 pr-3 tabular-nums">{r.place ?? "—"}</td>
        <td className="py-2 text-right whitespace-nowrap">
          <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={onEdit}>
            {editing ? "Cancel" : "Edit"}
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={show === "event" ? 6 : 5} className="pb-3">
            <form
              aria-label={`Correct ${label} on ${r.swimDate}`}
              className="flex flex-wrap items-end gap-2 rounded border border-dashed p-2 text-sm"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const place = String(f.get("place") ?? "").trim();
                setError(null);
                await act(
                  call(`/api/v1/swim/results/${r.id}`, "PATCH", {
                    time: String(f.get("time") ?? ""),
                    dqReason: String(f.get("dq") ?? "") || null,
                    place: place ? Number(place) : null,
                  }).catch((err) => {
                    setError((err as Error).message);
                    throw err;
                  }),
                  "Saved. Your correction stays through future syncs.",
                );
              }}
            >
              <label className="flex flex-col">
                Time
                <input
                  name="time"
                  defaultValue={r.timeMs === null ? "" : formatSwimTime(r.timeMs)}
                  inputMode="decimal"
                  className="w-24 rounded border px-2 py-1"
                />
              </label>
              <label className="flex flex-col">
                DQ reason
                <input name="dq" defaultValue={r.dqReason ?? ""} className="w-36 rounded border px-2 py-1" />
              </label>
              <label className="flex flex-col">
                Place
                <input
                  name="place"
                  type="number"
                  min={0}
                  defaultValue={r.place ?? ""}
                  className="w-16 rounded border px-2 py-1"
                />
              </label>
              <button type="submit" className="rounded bg-blue-700 px-3 py-1 text-white">
                Save correction
              </button>
              {r.corrected && r.source && (
                <button
                  type="button"
                  className="rounded border px-3 py-1"
                  onClick={() =>
                    act(
                      call(`/api/v1/swim/results/${r.id}/use-source`),
                      "Now showing Commit Swimming's version.",
                    )
                  }
                >
                  Use Commit&apos;s {r.source.dqReason ? "DQ" : formatSwimTime(r.source.timeMs)}
                </button>
              )}
              <button
                type="button"
                className="rounded border border-red-700 px-3 py-1 text-red-700 dark:text-red-400"
                onClick={() => act(call(`/api/v1/swim/results/${r.id}`, "DELETE"), "Swim deleted.")}
              >
                Delete
              </button>
              {error && <p className="w-full text-red-700 dark:text-red-400">{error}</p>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
