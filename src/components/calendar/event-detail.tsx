"use client";

import { useState } from "react";
import { ATTENDANCE, type Attendance } from "@/domain/constants";
import type { ClashView, EventView, Undo } from "@/lib/calendar-types";
import { call } from "./api";
import { CATEGORY_INFO } from "./categories";
import { formatWhen, fromLocalInputs, toLocalInputs } from "./time-format";
import { externalHref } from "@/lib/external-href";

// Event detail (CAL-4) with the non-drag ways to resolve clashes (NFR-9,
// CON-3, CON-4): Move to…, Skip, Accept clash, and back to the source time;
// and whose event it is (a parent's own appointment never clashes).
export function EventDetail(props: {
  event: EventView;
  clashes: (ClashView & { other?: EventView })[];
  tz: string;
  onAction: (message: string, undo?: Undo) => void;
  onEdit: () => void;
}) {
  const { event: e, tz } = props;
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = CATEGORY_INFO[e.category];
  const o = e.override;
  const fromSource = !!e.source;
  const act = async (fn: () => Promise<{ undo?: Undo } | null>, message: string) => {
    setError(null);
    try {
      const res = await fn();
      props.onAction(message, res?.undo);
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
        {o?.skip && " · skipped (Jayden won't attend)"}
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
          You moved this (was {formatWhen(o.originalStart, o.originalEnd, e.allDay, tz)} at the source).
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
                {` (overlaps ${c.overlapMin} min)`}
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

      <label className="flex flex-wrap items-center gap-2">
        Jayden&apos;s attendance
        <select
          value={e.attendance}
          onChange={(ev) => {
            const attendance = ev.target.value as Attendance;
            act(
              () => call(`/api/v1/events/${e.id}/attendance`, "POST", { attendance }),
              attendance === "required"
                ? "Jayden needs to be there."
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
        {!fromSource && (
          <button
            className="rounded border border-red-700 px-3 py-1 text-red-700 dark:text-red-400"
            onClick={() => act(() => call(`/api/v1/events/${e.id}`, "DELETE"), "Deleted.")}
          >
            Delete
          </button>
        )}
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
  parent_only: "parent only",
};
