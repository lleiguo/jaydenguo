"use client";

import { useState } from "react";
import { ATTENDANCE, CATEGORIES } from "@/domain/constants";
import type { EventView } from "@/lib/calendar-types";
import { call } from "./api";
import { CATEGORY_INFO } from "./categories";
import { fromLocalInputs, toLocalInputs } from "./time-format";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Series = {
  id: string;
  title: string;
  category: string;
  attendance: string;
  notes: string | null;
  locationName: string | null;
  allDay: boolean;
  startDate: string;
  untilDate: string | null;
  startTime: string;
  durationMin: number;
  intervalWeeks: number;
  weekdays: number[];
};

// Add or edit a manual event, one-off or repeating (CAL-5).
export function EventForm(props: {
  tz: string;
  event?: EventView;
  series?: Series;
  defaultDate?: string;
  onSaved: (message: string) => void;
}) {
  const { tz, event, series } = props;
  const initial = event ? toLocalInputs(event.start, tz) : null;
  const initialEnd = event ? toLocalInputs(event.end, tz) : null;
  const [repeat, setRepeat] = useState(!!series);
  const [allDay, setAllDay] = useState(series?.allDay ?? event?.allDay ?? false);
  const [error, setError] = useState<string | null>(null);
  const endTimeFromSeries = series
    ? (() => {
        const [h, m] = series.startTime.split(":").map(Number);
        const total = h * 60 + m + series.durationMin;
        return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
      })()
    : undefined;

  return (
    <form
      className="flex flex-col gap-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const s = (k: string) => String(f.get(k) ?? "");
        const base = {
          title: s("title"),
          category: s("category"),
          attendance: s("attendance"),
          notes: s("notes") || null,
          locationName: s("location") || null,
          allDay,
        };
        setError(null);
        try {
          if (repeat) {
            const [sh, sm] = (s("startTime") || "00:00").split(":").map(Number);
            const [eh, em] = (s("endTime") || "00:00").split(":").map(Number);
            let duration = eh * 60 + em - (sh * 60 + sm);
            if (allDay) duration = 1440;
            if (duration <= 0) throw new Error("The end time must be after the start time.");
            const weekdays = f.getAll("weekday").map(Number);
            if (weekdays.length === 0) throw new Error("Pick at least one day of the week.");
            const body = {
              ...base,
              startDate: s("date"),
              untilDate: s("until") || null,
              startTime: allDay ? "00:00" : s("startTime"),
              durationMin: duration,
              intervalWeeks: Number(s("interval") || 1),
              weekdays,
            };
            if (series) await call(`/api/v1/series/${series.id}`, "PATCH", body);
            else await call("/api/v1/series", "POST", body);
          } else {
            const date = s("date");
            const endDate = s("endDate") || date;
            const start = allDay ? new Date(`${date}T00:00:00Z`) : fromLocalInputs(date, s("startTime"), tz);
            const end = allDay
              ? new Date(Date.parse(`${endDate}T00:00:00Z`) + 86_400_000)
              : fromLocalInputs(endDate, s("endTime"), tz);
            if (end < start) throw new Error("The end must be after the start.");
            const body = { ...base, start, end };
            if (event) await call(`/api/v1/events/${event.id}`, "PATCH", body);
            else await call("/api/v1/events", "POST", body);
          }
          props.onSaved(event || series ? "Saved." : "Added.");
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label className="flex flex-col">
        Title
        <input
          name="title"
          required
          defaultValue={series?.title ?? event?.title ?? ""}
          className="rounded border px-2 py-1"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col">
          Category
          <select
            name="category"
            defaultValue={series?.category ?? event?.category ?? "other"}
            className="rounded border px-2 py-1"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_INFO[c].icon} {CATEGORY_INFO[c].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Jayden&apos;s attendance
          <select
            name="attendance"
            defaultValue={series?.attendance ?? event?.attendance ?? "required"}
            className="rounded border px-2 py-1"
          >
            {ATTENDANCE.map((a) => (
              <option key={a} value={a}>
                {a === "parent_only" ? "parent only" : a}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col">
          {repeat ? "First date" : "Date"}
          <input
            name="date"
            type="date"
            required
            defaultValue={series?.startDate ?? initial?.date ?? props.defaultDate}
            className="rounded border px-2 py-1"
          />
        </label>
        {!repeat && (
          <label className="flex flex-col">
            End date
            <input
              name="endDate"
              type="date"
              defaultValue={initialEnd?.date}
              className="rounded border px-2 py-1"
            />
          </label>
        )}
        {!allDay && (
          <>
            <label className="flex flex-col">
              Start time
              <input
                name="startTime"
                type="time"
                required
                defaultValue={series?.startTime ?? initial?.time ?? "17:00"}
                className="rounded border px-2 py-1"
              />
            </label>
            <label className="flex flex-col">
              End time
              <input
                name="endTime"
                type="time"
                required
                defaultValue={endTimeFromSeries ?? initialEnd?.time ?? "18:00"}
                className="rounded border px-2 py-1"
              />
            </label>
          </>
        )}
      </div>
      {!event && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => setRepeat(e.target.checked)}
            disabled={!!series}
          />{" "}
          Repeats weekly
        </label>
      )}
      {repeat && (
        <fieldset className="flex flex-col gap-2 rounded border p-2">
          <legend className="px-1">Repeat</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="weekday"
                  value={i}
                  defaultChecked={series?.weekdays.includes(i)}
                />{" "}
                {d}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col">
              Every … weeks
              <input
                name="interval"
                type="number"
                min={1}
                max={52}
                defaultValue={series?.intervalWeeks ?? 1}
                className="rounded border px-2 py-1"
              />
            </label>
            <label className="flex flex-col">
              Until (optional)
              <input
                name="until"
                type="date"
                defaultValue={series?.untilDate ?? ""}
                className="rounded border px-2 py-1"
              />
            </label>
          </div>
        </fieldset>
      )}
      <label className="flex flex-col">
        Location
        <input
          name="location"
          defaultValue={series?.locationName ?? event?.locationName ?? ""}
          className="rounded border px-2 py-1"
        />
      </label>
      <label className="flex flex-col">
        Notes
        <textarea
          name="notes"
          rows={2}
          defaultValue={series?.notes ?? event?.notes ?? ""}
          className="rounded border px-2 py-1"
        />
      </label>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <button type="submit" className="self-start rounded bg-blue-700 px-4 py-2 text-white">
        Save
      </button>
    </form>
  );
}
