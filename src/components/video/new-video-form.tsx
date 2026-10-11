"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/components/calendar/api";
import { AUTO_SPORT, SPORT_LABEL, VIDEO_SPORTS } from "@/domain/video-constants";
import { parseClockTime } from "@/domain/video-links";

const field = "rounded border px-2 py-1.5 dark:bg-neutral-900";

// VID-1: a link (Google Drive, or YouTube kept without review, F-3) or a
// pick from Google Photos (F-4), with sport (worked out from the video by
// default: intent 0005, SPT-1), date filmed, note, and an optional segment
// to review.
export function NewVideoForm({ today, connected }: { today: string; connected: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setError(null);
    // Read from the form, not from state: a tap before the page hydrates
    // still counts.
    const source = form.get("source") === "photos" ? "photos" : "link";
    const url = String(form.get("url") ?? "").trim();
    if (source === "link" && !url) {
      setError("Paste the video's link, or pick from Google Photos.");
      return;
    }
    const start = parseClockTime(String(form.get("start") ?? ""));
    const end = parseClockTime(String(form.get("end") ?? ""));
    if (Number.isNaN(start) || Number.isNaN(end)) {
      setError("Enter segment times as m:ss, e.g. 0:12.");
      return;
    }
    setBusy(true);
    try {
      const created = await call<{ id: string; status: string }>("/api/v1/videos", "POST", {
        url: source === "link" ? url : null,
        sport: form.get("sport"),
        filmedOn: form.get("filmedOn"),
        note: String(form.get("note") ?? "") || null,
        segmentStart: start,
        segmentEnd: end,
      });
      if (created.status === "saved") router.refresh();
      else router.push(`/videos/${created.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    // The link field or the Photos hint shows by which radio is checked,
    // in CSS, so it works before the page hydrates.
    <form action={submit} className="group flex max-w-xl flex-col gap-3 text-sm">
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">Where the video is</legend>
        <label className="flex items-center gap-1">
          <input type="radio" name="source" value="link" defaultChecked />
          Paste a link
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="source" value="photos" />
          Pick from Google Photos
        </label>
      </fieldset>
      <label className="flex flex-col gap-1 group-has-[input[value=photos]:checked]:hidden">
        Video link
        <input name="url" type="url" placeholder="https://drive.google.com/file/d/…" className={field} />
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          Google Drive links are reviewed. YouTube links are saved with your note but can&apos;t be reviewed.
        </span>
      </label>
      <p className="hidden text-xs text-neutral-600 group-has-[input[value=photos]:checked]:block dark:text-neutral-400">
        After you press Review, a Google Photos link appears. Open it, pick one video, and come back.
        {!connected && " First connect Google Drive and Photos (above)."}
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          Sport
          <select name="sport" defaultValue={AUTO_SPORT} className={field}>
            <option value={AUTO_SPORT}>Detect automatically</option>
            {VIDEO_SPORTS.map((s) => (
              <option key={s} value={s}>
                {SPORT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Date filmed
          <input name="filmedOn" type="date" required defaultValue={today} max={today} className={field} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        Note (what to look at)
        <input name="note" maxLength={500} placeholder="second serve, focus on toss" className={field} />
      </label>
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="mb-1">
          Part to review (optional: the whole video if empty, up to 10 minutes)
        </legend>
        <label className="flex flex-col gap-1">
          From
          <input name="start" inputMode="decimal" placeholder="0:00" className={`${field} w-24`} />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input name="end" inputMode="decimal" placeholder="0:30" className={`${field} w-24`} />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border bg-neutral-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {busy ? "Saving…" : "Review"}
        </button>
      </div>
    </form>
  );
}
