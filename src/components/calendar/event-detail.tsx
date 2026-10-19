"use client";

import { useState } from "react";
import { ATTENDANCE, GOOGLE_ACTOR, type Attendance } from "@/domain/constants";
import type { Person } from "@/domain/people";
import type { ClashView, EventView, Undo } from "@/lib/calendar-types";
import { call } from "./api";
import { CATEGORY_INFO } from "./categories";
import { formatWhen, fromLocalInputs, toLocalInputs } from "./time-format";
import { externalHref } from "@/lib/external-href";
import { deleteConfirm } from "@/domain/delete-confirm";
import { HOUSEHOLD_KINDS } from "@/domain/duplicates";

// Whether two-way sync with the household calendar is On (intent 0020).
async function householdOn(): Promise<boolean> {
  const res = await fetch("/api/v1/household-sync");
  return res.ok && (await res.json()).mode === "on";
}

// Event detail (CAL-4) with the non-drag ways to resolve clashes (NFR-9,
// CON-3, CON-4): Move to…, Skip, Accept clash, and back to the source time;
// and whose event it is (it only clashes with the same person's events).
export function EventDetail(props: {
  event: EventView;
  clashes: (ClashView & { other?: EventView })[];
  people: Person[];
  tz: string;
  onAction: (message: string, undo?: Undo) => void;
  onEdit: () => void;
}) {
  const { event: e, tz, people } = props;
  const names = (ids: string[]) =>
    people
      .filter((p) => ids.includes(p.id))
      .map((p) => p.name)
      .join(", ");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = CATEGORY_INFO[e.category];
  const o = e.override;
  const fromSource = !!e.source;
  type Result = { undo?: Undo; count?: number } | null;
  const act = async (fn: () => Promise<Result>, message: string | ((res: Result) => string)) => {
    setError(null);
    try {
      const res = await fn();
      props.onAction(typeof message === "string" ? message : message(res), res?.undo);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        <span aria-hidden>{info.icon}</span> {info.label}
        {e.attendance !== "required" && ` · ${ATTENDANCE_LABEL[e.attendance]}`}
        {e.status === "cancelled" && " · cancelled by the source"}
        {o?.skip && " · skipped (won't attend)"}
      </p>
      <p className="font-medium">{formatWhen(e.start, e.end, e.allDay, tz)}</p>
      {e.schoolClosed && <p>🚫 School is closed this day.</p>}
      {e.locationName && <p>📍 {e.locationName}</p>}
      {e.notes && <p className="whitespace-pre-wrap">{e.notes}</p>}

      <div className="rounded border p-2" data-testid="event-source">
        {e.source ? (
          <>
            From <strong>{e.source.name}</strong>
            {e.lastSyncedAt && <>, last synced {new Date(e.lastSyncedAt).toLocaleString()}</>}.
          </>
        ) : e.seriesId ? (
          "A repeating event added on this site."
        ) : (
          "Added on this site."
        )}
        {externalHref(e.sourceUrl) && (
          <>
            {" "}
            <a
              className="underline"
              href={externalHref(e.sourceUrl)}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open at the source
            </a>
          </>
        )}
      </div>

      {o?.moved && (
        <div className="rounded border p-2" data-testid="moved-info">
          {o.createdBy === GOOGLE_ACTOR ? "Changed in Google Calendar" : "You moved this"} (was{" "}
          {formatWhen(o.originalStart, o.originalEnd, e.allDay, tz)} at the source).
          {o.sourceChangedAt && (
            <p className="mt-1 font-medium text-amber-800 dark:text-amber-300" role="status">
              ⚠ Source changed since you moved this.
              {o.snapshot &&
                ` When you moved it, the source had ${formatWhen(o.snapshot.start, o.snapshot.end, e.allDay, tz)}.`}
            </p>
          )}
        </div>
      )}

      {props.clashes.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-red-700 dark:text-red-400">⚠ Clashes</h3>
          {props.clashes.map((c) => (
            <div key={`${c.a}-${c.b}`} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {c.other
                  ? `${CATEGORY_INFO[c.other.category].icon} ${c.other.title}, ${formatWhen(c.other.start, c.other.end, c.other.allDay, tz)}`
                  : "Another event"}
                {` (overlaps ${c.overlapMin} min`}
                {people.length > 1 && c.people.length > 0 && `, for ${names(c.people)}`}
                {")"}
                {c.acceptedId && " · accepted"}
              </span>
              {c.acceptedId ? (
                <button
                  className="rounded border px-2 py-1"
                  onClick={() =>
                    act(() => call(`/api/v1/clashes/${c.acceptedId}/undo`), "Clash no longer accepted.")
                  }
                >
                  Un-accept
                </button>
              ) : (
                <button
                  className="rounded border px-2 py-1"
                  onClick={() =>
                    act(() => call("/api/v1/clashes", "POST", { a: c.a, b: c.b }), "Clash accepted.")
                  }
                >
                  Accept clash
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {people.length > 1 && (
        <fieldset className="flex flex-wrap items-center gap-3" data-testid="event-owners">
          <legend className="float-left mr-2">Whose event</legend>
          {people.map((p) => {
            const on = e.owners.includes(p.id);
            return (
              <label key={p.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={on}
                  // Someone always owns it.
                  disabled={on && e.owners.length === 1}
                  onChange={() => {
                    const ownerIds = on ? e.owners.filter((id) => id !== p.id) : [...e.owners, p.id];
                    act(
                      () => call(`/api/v1/events/${e.id}/owners`, "POST", { ownerIds }),
                      `Now ${names(ownerIds)}'s.`,
                    );
                  }}
                />
                {p.name}
              </label>
            );
          })}
          {o?.owners && fromSource && <span className="text-xs">(changed here; the source isn&apos;t)</span>}
        </fieldset>
      )}

      <label className="flex flex-wrap items-center gap-2">
        Attendance
        <select
          value={e.attendance}
          onChange={(ev) => {
            const attendance = ev.target.value as Attendance;
            act(
              () => call(`/api/v1/events/${e.id}/attendance`, "POST", { attendance }),
              attendance === "required"
                ? "Marked required."
                : `Marked ${ATTENDANCE_LABEL[attendance]}; it won't clash.`,
            );
          }}
          className="rounded border px-2 py-1"
        >
          {ATTENDANCE.map((a) => (
            <option key={a} value={a}>
              {ATTENDANCE_LABEL[a]}
            </option>
          ))}
        </select>
        {o?.attendance && fromSource && (
          <span className="text-xs">(changed here; the source isn&apos;t)</span>
        )}
      </label>

      <div className="flex flex-wrap gap-2">
        {e.status === "active" && (
          <button
            className="rounded border px-3 py-1"
            onClick={() => setMoving((v) => !v)}
            aria-expanded={moving}
          >
            Move to…
          </button>
        )}
        <button
          className="rounded border px-3 py-1"
          onClick={() =>
            act(
              () => call(`/api/v1/events/${e.id}/skip`, "POST", { skip: !o?.skip }),
              o?.skip ? "Not skipped any more." : "Skipped.",
            )
          }
        >
          {o?.skip ? "Don't skip" : "Skip this one"}
        </button>
        {e.repeats && (
          <button
            className="rounded border px-3 py-1"
            onClick={() =>
              act(
                () =>
                  call<{ undo: Undo; count: number }>(`/api/v1/events/${e.id}/skip-repeats`, "POST", {
                    skip: !o?.skip,
                  }),
                (res) => repeatsMessage(!o?.skip, res?.count ?? 0),
              )
            }
          >
            {o?.skip ? "Don't skip any repeats" : "Skip every repeat"}
          </button>
        )}
        {o?.moved && (
          <button
            className="rounded border px-3 py-1"
            onClick={() => act(() => call(`/api/v1/events/${e.id}/reset`), "Back to the source's time.")}
          >
            Use the source&apos;s time
          </button>
        )}
        {!fromSource && (
          <button className="rounded border px-3 py-1" onClick={props.onEdit}>
            {e.seriesId ? "Edit series" : "Edit"}
          </button>
        )}
        {/* Intent 0022, DEL-2: any event, after "Delete?". */}
        <button
          className="rounded border border-red-700 px-3 py-1 text-red-700 dark:text-red-400"
          onClick={async () => {
            const household = !!e.source && HOUSEHOLD_KINDS.includes(e.source.kind);
            const on = household && (await householdOn());
            if (!window.confirm(deleteConfirm(e.title, e.source, on))) return;
            await act(
              () => call(`/api/v1/events/${e.id}`, "DELETE"),
              on ? "Deleted; it goes from Google Calendar shortly." : "Deleted.",
            );
          }}
        >
          Delete
        </button>
      </div>

      {moving && (
        <MoveForm
          event={e}
          tz={tz}
          onMove={(start, end) =>
            act(() => call(`/api/v1/events/${e.id}/move`, "POST", { start, end }), "Moved.")
          }
        />
      )}
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function MoveForm({
  event,
  tz,
  onMove,
}: {
  event: EventView;
  tz: string;
  onMove: (start: Date, end: Date) => void;
}) {
  const cur = toLocalInputs(event.start, tz);
  const duration = new Date(event.end).getTime() - new Date(event.start).getTime();
  return (
    <form
      aria-label="Move to"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget);
        const date = String(f.get("date"));
        const start = event.allDay
          ? new Date(`${date}T00:00:00Z`)
          : fromLocalInputs(date, String(f.get("time")), tz);
        onMove(start, new Date(start.getTime() + duration));
      }}
    >
      <label className="flex flex-col">
        New date
        <input
          name="date"
          type="date"
          required
          defaultValue={event.allDay ? event.start.slice(0, 10) : cur.date}
          className="rounded border px-2 py-1"
        />
      </label>
      {!event.allDay && (
        <label className="flex flex-col">
          New start time
          <input
            name="time"
            type="time"
            required
            defaultValue={cur.time}
            className="rounded border px-2 py-1"
          />
        </label>
      )}
      <button type="submit" className="rounded bg-blue-700 px-3 py-1 text-white">
        Move
      </button>
    </form>
  );
}

const ATTENDANCE_LABEL: Record<Attendance, string> = {
  required: "required",
  optional: "optional",
};

// After "skip every repeat" or its reverse.
function repeatsMessage(skip: boolean, count: number) {
  const n = count === 1 ? "1 occurrence" : `${count} occurrences`;
  return skip ? `Skipped ${n}.` : `${n[0].toUpperCase()}${n.slice(1)} not skipped any more.`;
}
