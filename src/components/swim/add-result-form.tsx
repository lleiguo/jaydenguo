"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/components/calendar/api";
import { COURSES, DISTANCES, STROKES, STROKE_LABEL } from "@/domain/swim-constants";

// SWM-7 / SYNC-6: add a swim by hand, e.g. on meet day before the results
// reach Commit Swimming. When the source's copy arrives, sync links the two
// and flags them if the times differ.

type MeetOption = { id: string; name: string; startDate: string; course: string | null };

export function AddResultForm({
  meets,
  today,
  meetId,
}: {
  meets: MeetOption[];
  today: string;
  meetId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [meetChoice, setMeetChoice] = useState(meetId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const chosen = meets.find((m) => m.id === meetChoice);

  if (!open)
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="self-start rounded border px-3 py-1 text-sm"
          onClick={() => setOpen(true)}
        >
          + Add a swim
        </button>
        {saved && (
          <p role="status" className="text-sm">
            {saved}
          </p>
        )}
      </div>
    );
  return (
    <form
      aria-label="Add a swim"
      className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const s = (k: string) => String(f.get(k) ?? "").trim();
        const place = s("place");
        const body: Record<string, unknown> = {
          swimDate: s("swimDate"),
          distance: Number(s("distance")),
          stroke: s("stroke"),
          course: s("course"),
          time: s("time"),
          dqReason: s("dq") || undefined,
          place: place ? Number(place) : null,
          notes: s("notes") || undefined,
        };
        if (meetChoice === "new")
          body.newMeet = { name: s("meetName"), course: s("course"), startDate: s("swimDate") };
        else if (meetChoice) body.meetId = meetChoice;
        try {
          await call("/api/v1/swim/results", "POST", body);
          setError(null);
          setSaved("Swim added.");
          setOpen(false);
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h2 className="text-base font-semibold">Add a swim</h2>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col">
          Meet
          <select
            aria-label="Meet"
            value={meetChoice}
            onChange={(e) => setMeetChoice(e.target.value)}
            className="max-w-64 rounded border px-2 py-1"
          >
            <option value="">No meet (e.g. a time trial)</option>
            {meets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.startDate} · {m.name}
              </option>
            ))}
            <option value="new">A meet not listed…</option>
          </select>
        </label>
        {meetChoice === "new" && (
          <label className="flex flex-col">
            Meet name
            <input name="meetName" required className="rounded border px-2 py-1" />
          </label>
        )}
        <label className="flex flex-col">
          Date
          <input
            name="swimDate"
            type="date"
            required
            defaultValue={chosen?.startDate ?? today}
            key={chosen?.id ?? "none"}
            className="rounded border px-2 py-1"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col">
          Distance
          <select name="distance" defaultValue="50" className="rounded border px-2 py-1">
            {DISTANCES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Stroke
          <select name="stroke" defaultValue="free" className="rounded border px-2 py-1">
            {STROKES.map((s) => (
              <option key={s} value={s}>
                {STROKE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Course
          <select
            name="course"
            defaultValue={chosen?.course ?? "SCM"}
            key={`c-${chosen?.id ?? "none"}`}
            className="rounded border px-2 py-1"
          >
            {COURSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Time
          <input
            name="time"
            placeholder="1:08.23"
            inputMode="decimal"
            className="w-24 rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col">
          Place
          <input name="place" type="number" min={0} className="w-16 rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col">
          DQ reason (if any)
          <input name="dq" className="w-40 rounded border px-2 py-1" />
        </label>
      </div>
      <label className="flex flex-col">
        Notes
        <input name="notes" className="rounded border px-2 py-1" />
      </label>
      {error && <p className="text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="rounded bg-blue-700 px-3 py-1 text-white">
          Add swim
        </button>
        <button type="button" className="rounded border px-3 py-1" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
