"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/components/calendar/api";

// SYNC-2: "Refresh" on the sport page starts a sync of its source(s), and
// on the calendar of every source ("all"). The same one-per-hour limit
// applies; the Sources page shows progress.
export function RefreshButton({
  sourceIds,
  site,
  what,
}: {
  sourceIds: string[] | "all";
  // e.g. "Commit Swimming", and what its source syncs.
  site: string;
  what: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  if (sourceIds !== "all" && !sourceIds.length)
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Add a {site} source on the{" "}
        <a href="/settings/sources" className="underline">
          Sources page
        </a>{" "}
        to sync {what}.
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        className="rounded border px-3 py-1"
        onClick={async () => {
          try {
            if (sourceIds === "all") await call("/api/v1/sources/refresh-all");
            else for (const id of sourceIds) await call(`/api/v1/sources/${id}/refresh`);
            setMessage(`Refreshing from ${site}. This takes a minute or two.`);
            setTimeout(() => router.refresh(), 90_000);
          } catch (err) {
            setMessage((err as Error).message);
          }
        }}
      >
        ↻ Refresh
      </button>
      {message && <span role="status">{message}</span>}
    </div>
  );
}
