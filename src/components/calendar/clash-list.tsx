"use client";

import { useCallback, useEffect, useState } from "react";
import type { Person } from "@/domain/people";
import type { ClashView, EventView, Undo } from "@/lib/calendar-types";
import { call } from "./api";
import { CATEGORY_INFO } from "./categories";
import { formatWhen } from "./time-format";
import { announceChange, useLiveUpdates } from "./use-live-updates";
import { UndoToast, nextToastId, type Toast } from "./undo-toast";

type Row = ClashView & { eventA: EventView; eventB: EventView };

// CON-2 clash list: each pair, with quick ways to resolve it (CON-4).
export function ClashList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tz, setTz] = useState("UTC");
  const [people, setPeople] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const load = useCallback(async () => {
    const [res, ch] = await Promise.all([fetch("/api/v1/clashes?days=60"), fetch("/api/v1/changes?since=0")]);
    if (res.ok) {
      const body = await res.json();
      setRows(body.clashes);
      setTz(body.homeTimeZone);
      setPeople(body.people);
    }
    if (ch.ok) setCursor((await ch.json()).cursor);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useLiveUpdates(cursor, load);

  const act = async (p: Promise<{ undo?: Undo } | null>, message: string) => {
    try {
      const res = await p;
      setToast({ message, undo: res?.undo, id: nextToastId() });
    } catch (err) {
      setToast({ message: (err as Error).message, id: nextToastId() });
    }
    await load();
    announceChange();
  };

  if (!rows) return <p>Loading…</p>;
  const open = rows.filter((r) => !r.acceptedId);
  const accepted = rows.filter((r) => r.acceptedId);
  const describe = (e: EventView) =>
    `${CATEGORY_INFO[e.category].icon} ${e.title} · ${formatWhen(e.start, e.end, e.allDay, tz)}`;

  return (
    <div className="flex flex-col gap-4">
      {open.length === 0 && <p>No clashes. 🎉</p>}
      <ul className="flex flex-col gap-3">
        {open.map((c) => (
          <li
            key={`${c.a}-${c.b}`}
            data-testid="clash"
            className="flex flex-col gap-2 rounded-lg border border-red-700 p-3 text-sm"
          >
            <p className="font-medium text-red-700 dark:text-red-400">
              ⚠ Overlap of {c.overlapMin} min
              {people.length > 1 &&
                ` for ${people
                  .filter((p) => c.people.includes(p.id))
                  .map((p) => p.name)
                  .join(" and ")}`}
            </p>
            {[c.eventA, c.eventB].map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{describe(e)}</span>
                <button
                  className="rounded border px-2 py-1"
                  onClick={() =>
                    act(call(`/api/v1/events/${e.id}/skip`, "POST", { skip: true }), `Skipped ${e.title}.`)
                  }
                >
                  Skip this one
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded bg-neutral-900 px-3 py-1 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                onClick={() => act(call("/api/v1/clashes", "POST", { a: c.a, b: c.b }), "Clash accepted.")}
              >
                Accept clash
              </button>
              <a
                className="rounded border px-2 py-1"
                href={`/?view=timeGridDay&date=${c.eventA.start.slice(0, 10)}`}
              >
                See the day
              </a>
            </div>
          </li>
        ))}
      </ul>
      {accepted.length > 0 && (
        <section aria-labelledby="accepted">
          <h3 id="accepted" className="font-semibold">
            Accepted
          </h3>
          <ul className="flex flex-col gap-2 text-sm">
            {accepted.map((c) => (
              <li key={c.acceptedId} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {describe(c.eventA)} and {describe(c.eventB)}
                </span>
                <button
                  className="rounded border px-2 py-1"
                  onClick={() => act(call(`/api/v1/clashes/${c.acceptedId}/undo`), "No longer accepted.")}
                >
                  Un-accept
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <UndoToast
        toast={toast}
        onDone={(undone) => {
          setToast(null);
          if (undone) void load().then(announceChange);
        }}
      />
    </div>
  );
}
