"use client";

import { useState } from "react";
import { call } from "@/components/calendar/api";
import type { ReviewMode } from "@/domain/video-constants";

const OPTIONS: { value: ReviewMode; label: string; hint: string }[] = [
  {
    value: "debate",
    label: "Two models debate (default)",
    hint: "Gemini and Claude each review, judge each other and agree on the advice. About $1.50–2 a video.",
  },
  { value: "gemini", label: "Gemini only", hint: "One review from the whole video. About $0.15 a video." },
  { value: "claude", label: "Claude only", hint: "One review from still frames. About $0.30 a video." },
];

// VID-3e: debate by default, or one model to save cost. Applies to new
// reviews.
export function ReviewModeSetting({ initial }: { initial: ReviewMode }) {
  const [mode, setMode] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="mb-1">How new videos are reviewed</legend>
      {OPTIONS.map((o) => (
        <label key={o.value} className="flex items-start gap-2">
          <input
            type="radio"
            name="review-mode"
            className="mt-1"
            checked={mode === o.value}
            onChange={async () => {
              const before = mode;
              setMode(o.value);
              try {
                await call("/api/v1/videos/settings", "PATCH", { mode: o.value });
                setMessage("Saved.");
              } catch (err) {
                setMode(before);
                setMessage((err as Error).message);
              }
            }}
          />
          <span>
            {o.label}
            <span className="block text-neutral-600 dark:text-neutral-400">{o.hint}</span>
          </span>
        </label>
      ))}
      <p aria-live="polite">{message}</p>
    </fieldset>
  );
}
