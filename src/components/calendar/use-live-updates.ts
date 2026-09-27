"use client";

import { useEffect, useRef } from "react";

export const CHANGED_EVENT = "hub:changed";

// CAL-8: while the page is visible, ask every few seconds whether anything
// changed since `cursor`; if so, call `onChange` and tell other widgets (the
// clash badge) through a window event. 8 s (rather than 10) keeps the worst
// case, including reloading the data, inside the 10 s the spec allows.
export function useLiveUpdates(cursor: number | null, onChange: () => void, intervalMs = 8_000) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (cursor === null) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/v1/changes?since=${cursor}`);
        if (!res.ok || stopped) return;
        const body = (await res.json()) as { changed: boolean };
        if (body.changed) {
          latest.current();
          window.dispatchEvent(new Event(CHANGED_EVENT));
        }
      } catch {
        // Offline for a moment; try again next tick.
      }
    };
    const timer = setInterval(check, intervalMs);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cursor, intervalMs]);
}

// Local changes made on this page: refresh other widgets straight away.
export function announceChange() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}
