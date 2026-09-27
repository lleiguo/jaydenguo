import type { Category } from "@/domain/constants";

// Icon and name for each category (CAL-1), so colour is never the only cue.
export const CATEGORY_INFO: Record<
  Category,
  { icon: string; label: string; layer: "school" | "activities" }
> = {
  tennis: { icon: "🎾", label: "Tennis", layer: "activities" },
  swimming: { icon: "🏊", label: "Swimming", layer: "activities" },
  soccer: { icon: "⚽", label: "Soccer", layer: "activities" },
  hockey: { icon: "🏒", label: "Hockey", layer: "activities" },
  math: { icon: "➗", label: "Math", layer: "activities" },
  chinese: { icon: "中", label: "Chinese", layer: "activities" },
  fitness: { icon: "💪", label: "Fitness", layer: "activities" },
  school_class: { icon: "🏫", label: "School class", layer: "school" },
  school_closure: { icon: "🚫", label: "School closed", layer: "school" },
  other: { icon: "•", label: "Other", layer: "activities" },
};
