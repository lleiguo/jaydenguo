"use client";

import { useEffect, useState } from "react";
import { CHANGED_EVENT } from "./calendar/use-live-updates";

// CON-2: how many upcoming clashes (next 60 days) aren't resolved yet.
export function ClashBadge() {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/v1/clashes?days=60");
      if (res.ok) setOpen((await res.json()).open);
    };
    void load();
    window.addEventListener(CHANGED_EVENT, load);
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => {
      window.removeEventListener(CHANGED_EVENT, load);
      clearInterval(t);
    };
  }, []);
  if (!open) return null;
  return (
    <span
      data-testid="clash-badge"
      aria-label={`${open} upcoming clashes`}
      className="ml-1 rounded-full bg-red-700 px-2 text-xs font-semibold text-white"
    >
      {open}
    </span>
  );
}
