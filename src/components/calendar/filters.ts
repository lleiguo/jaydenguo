"use client";

import { useEffect, useState } from "react";
import type { Category } from "@/domain/constants";

// Filters and layer chips persist per device (CAL-3, CAL-3a). Browser
// storage is a convenience: if it's unavailable, defaults are used.

export type Filters = {
  hiddenCategories: Category[];
  hiddenSources: string[];
  school: boolean;
  activities: boolean;
};
const KEY = "hub.calendar.filters.v1";
const DEFAULTS: Filters = { hiddenCategories: [], hiddenSources: [], school: true, activities: true };

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
