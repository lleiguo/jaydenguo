import type { Category } from "@/domain/constants";

// Icon and name for each category (CAL-1), so colour is never the only cue.
export const CATEGORY_INFO: Record<Category, { icon: string; label: string }> = {
  tennis: { icon: "🎾", label: "Tennis" },
  swimming: { icon: "🏊", label: "Swimming" },
  soccer: { icon: "⚽", label: "Soccer" },
  hockey: { icon: "🏒", label: "Hockey" },
  math: { icon: "➗", label: "Math" },
  chinese: { icon: "中", label: "Chinese" },
  fitness: { icon: "💪", label: "Fitness" },
  school_class: { icon: "🏫", label: "School class" },
  school_closure: { icon: "🚫", label: "School closed" },
  other: { icon: "•", label: "Other" },
};
