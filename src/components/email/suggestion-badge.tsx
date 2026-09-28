"use client";

import { useEffect, useState } from "react";

// EML-2: how many email suggestions wait for a decision.
export function SuggestionBadge() {
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/v1/suggestions");
      if (res.ok) setPending((await res.json()).pending);
    };
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 120_000);
    return () => clearInterval(t);
  }, []);
  if (!pending) return null;
  return (
    <span
      data-testid="suggestion-badge"
      aria-label={`${pending} suggestions to review`}
      className="ml-1 rounded-full bg-blue-700 px-2 text-xs font-semibold text-white"
    >
      {pending}
    </span>
  );
}
