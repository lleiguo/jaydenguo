"use client";

import { useEffect, useState } from "react";
import type { Category } from "@/domain/constants";

// Filters and people chips persist per device (CAL-3, CAL-3a). Browser
// storage is a convenience: if it's unavailable, defaults are used.

export type Filters = {
  hiddenCategories: Category[];
  hiddenSources: string[];
  // `people.id`s whose events are hidden.
  hiddenPeople: string[];
  // Skipped events are hidden until shown (intent 0011, TID-3, TID-4).
  showSkipped: boolean;
};
// v2: people chips replaced the School and Activities chips.
const KEY = "hub.calendar.filters.v2";
const DEFAULTS: Filters = { hiddenCategories: [], hiddenSources: [], hiddenPeople: [], showSkipped: false };

export function usePersistentFilters(): [Filters, (f: Filters) => void] {
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setFilters({ ...DEFAULTS, ...JSON.parse(saved) });
    } catch {
      // Private mode or blocked storage: keep the defaults.
    }
  }, []);
  const update = (f: Filters) => {
    setFilters(f);
    try {
      localStorage.setItem(KEY, JSON.stringify(f));
    } catch {
      // Ignore; the choice lasts for this visit.
    }
  };
  return [filters, update];
}
