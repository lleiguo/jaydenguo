"use client";

import { useCallback, useEffect, useState } from "react";
import type { EventView } from "@/lib/calendar-types";
import { call } from "./api";
import { CATEGORY_INFO } from "./categories";

export function DeletedList() {
  const [events, setEvents] = useState<EventView[] | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/v1/events/deleted");
    if (res.ok) setEvents((await res.json()).events);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  if (!events) return <p>Loading…</p>;
  if (events.length === 0) return <p>Nothing has been deleted.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <span>
            {CATEGORY_INFO[e.category].icon} {e.title} · {new Date(e.start).toLocaleString()}
            {e.source && ` · from ${e.source.name}`} · deleted{" "}
            {e.deletedAt && new Date(e.deletedAt).toLocaleDateString()}
          </span>
          <button
            className="rounded border px-2 py-1"
            onClick={async () => {
              await call(`/api/v1/events/${e.id}/restore`);
              await load();
            }}
          >
            Restore
          </button>
        </li>
      ))}
    </ul>
  );
}
