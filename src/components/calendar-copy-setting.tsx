"use client";

import { useEffect, useState } from "react";
import { call } from "@/components/calendar/api";
import type { CopySettings } from "@/server/calendar-copy";

type State = CopySettings & { accounts: { id: string; label: string }[] };

const muted = "text-sm text-neutral-600 dark:text-neutral-400";

// GCO-1, GCO-2: a one-way copy to a "Jayden (hub)" Google Calendar the site
// creates; switching off keeps or deletes it.
export function CalendarCopySetting() {
  const [s, setS] = useState<State | null>(null);
  const [account, setAccount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/v1/calendar-copy");
      if (res.ok) setS((await res.json()) as State);
    };
    void load();
  }, [version]);
  if (!s) return null;
  const chosen = account || s.credentialId || s.accounts[0]?.id || "";
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      setMessage(done);
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage((err as Error).message);
    }
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className={muted}>
        Copies every event, as it shows here, to a separate &quot;Jayden (hub)&quot; calendar in Google
        Calendar, once a day and when you press Copy now. Only that calendar is ever written; the household
        calendar never is.
      </p>
      {s.accounts.length === 0 ? (
        <p>
          <a className="underline" href="/accounts/google/connect?feature=calendar_copy&next=/settings">
            Connect a Google account for the copy
          </a>
        </p>
      ) : s.enabled ? (
        <>
          <p data-testid="calendar-copy-status">
            On, to {s.accounts.find((a) => a.id === s.credentialId)?.label ?? "a Google account"}.
            {s.lastRunAt && ` Last copied ${new Date(s.lastRunAt).toLocaleString()}`}
            {s.last && ` (${s.last.created} added, ${s.last.updated} changed, ${s.last.deleted} removed)`}
            {s.lastRunAt && "."}
          </p>
          {s.lastError && <p className="text-red-700 dark:text-red-400">{s.lastError}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() => act(() => call("/api/v1/calendar-copy/run"), "Copying. This takes a minute.")}
            >
              Copy now
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() =>
                act(
                  () => call("/api/v1/calendar-copy", "PATCH", { enabled: false, keep: true }),
                  "Switched off. The copy stays in Google Calendar as it is.",
                )
              }
            >
              Switch off, keep the copy
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() => {
                if (!confirm('Delete the "Jayden (hub)" calendar from Google Calendar?')) return;
                void act(
                  () => call("/api/v1/calendar-copy", "PATCH", { enabled: false, keep: false }),
                  "Switched off. The copy is being deleted from Google Calendar.",
                );
              }}
            >
              Switch off and delete the copy
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col">
            Google account
            <select
              value={chosen}
              onChange={(e) => setAccount(e.target.value)}
              className="rounded border px-2 py-1 dark:bg-neutral-900"
            >
              {s.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() =>
              act(
                () => call("/api/v1/calendar-copy", "PATCH", { enabled: true, credentialId: chosen }),
                "Switched on. The first copy takes a minute or two.",
              )
            }
          >
            Switch on
          </button>
        </div>
      )}
      <p aria-live="polite">{message}</p>
    </div>
  );
}
