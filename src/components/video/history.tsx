"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { call } from "@/components/calendar/api";
import { sportText, type VideoSport } from "@/domain/video-constants";
import type { VideoReviewSummary } from "@/server/video/store";

export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  picking: "Waiting for your pick",
  analysing: "Analysing",
  done: "Done",
  failed: "Failed",
  saved: "Saved (not reviewable)",
};

export const inProgress = (status: string) => ["queued", "picking", "analysing"].includes(status);

const PROVIDER_LABEL: Record<string, string> = {
  drive: "Google Drive",
  photos: "Google Photos",
  youtube: "YouTube",
  other: "Link",
};

// VID-4: newest first with link, note, date and status; two
// can be compared side by side; deleted ones can be restored. Polls while
// any review is still running (VID-5).
export function VideoHistory({
  initial,
  sport,
  deleted,
}: {
  initial: VideoReviewSummary[];
  sport?: VideoSport;
  deleted: boolean;
}) {
  const router = useRouter();
  const [reviews, setReviews] = useState(initial);
  const [compare, setCompare] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const running = reviews.some((r) => inProgress(r.status));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const q = new URLSearchParams();
      if (sport) q.set("sport", sport);
      const res = await fetch(`/api/v1/videos?${q}`);
      if (res.ok) setReviews(((await res.json()) as { reviews: VideoReviewSummary[] }).reviews);
    }, 4000);
    return () => clearInterval(timer);
  }, [running, sport]);

  if (!reviews.length)
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {deleted ? "No deleted reviews." : "No videos yet."}
      </p>
    );

  const toggle = (id: string) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-2)));

  return (
    <div className="flex flex-col gap-2">
      {!deleted && (
        <div className="flex min-h-8 flex-wrap items-center gap-2 text-sm">
          {compare.length === 2 ? (
            <Link href={`/videos/compare?ids=${compare.join(",")}`} className="rounded border px-3 py-1">
              Compare the two selected
            </Link>
          ) : (
            <span className="text-neutral-600 dark:text-neutral-400">
              Tick two finished reviews to compare them.
            </span>
          )}
        </div>
      )}
      <p aria-live="polite" className="text-sm">
        {message}
      </p>
      <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border dark:divide-neutral-800">
        {reviews.map((r) => (
          <li key={r.id} data-testid="video-row" className="flex flex-wrap items-start gap-3 p-3 text-sm">
            {!deleted && (
              <input
                type="checkbox"
                aria-label={`Compare the review of ${r.filmedOn}`}
                disabled={r.status !== "done"}
                checked={compare.includes(r.id)}
                onChange={() => toggle(r.id)}
                className="mt-1"
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/videos/${r.id}`} className="font-medium underline">
                  {sportText(r.sport, r.sportSource)} · {r.filmedOn}
                </Link>
                <span data-testid="video-status" className={statusTone(r.status)}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>
              {r.note && <p className="break-words">{r.note}</p>}
              <p className="truncate text-neutral-600 dark:text-neutral-400">
                {PROVIDER_LABEL[r.provider]}
                {r.mediaName && ` · ${r.mediaName}`}
                {r.url && (
                  <>
                    {" · "}
                    <a href={r.url} target="_blank" rel="noreferrer noopener" className="underline">
                      open
                    </a>
                  </>
                )}
              </p>
              {r.status === "picking" && r.pickerUri && (
                <a
                  href={r.pickerUri}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium underline"
                >
                  Pick the video in Google Photos
                </a>
              )}
              {inProgress(r.status) && r.progress && <p>{r.progress}…</p>}
              {r.status === "failed" && r.errorMessage && (
                <p className="text-red-700 dark:text-red-400">{r.errorMessage}</p>
              )}
            </div>
            <button
              type="button"
              className="rounded border px-2 py-1"
              onClick={async () => {
                try {
                  if (deleted) await call(`/api/v1/videos/${r.id}/restore`);
                  else await call(`/api/v1/videos/${r.id}`, "DELETE");
                  setMessage(deleted ? "Restored." : "Deleted. You can restore it from Deleted reviews.");
                  setReviews((all) => all.filter((x) => x.id !== r.id));
                  router.refresh();
                } catch (err) {
                  setMessage((err as Error).message);
                }
              }}
            >
              {deleted ? "Restore" : "Delete"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function statusTone(status: string) {
  if (status === "failed") return "text-red-700 dark:text-red-400";
  if (status === "done") return "text-green-700 dark:text-green-400";
  return "text-amber-700 dark:text-amber-400";
}
