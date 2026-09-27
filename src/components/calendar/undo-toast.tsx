"use client";

import { useEffect, useState } from "react";
import type { Undo } from "@/lib/calendar-types";
import { runUndo } from "./api";

export type Toast = { message: string; undo?: Undo; id: number };

let lastToastId = 0;
export const nextToastId = () => ++lastToastId;

// CON-3: "Undo is available for 10 s".
export function UndoToast({ toast, onDone }: { toast: Toast | null; onDone: (undone: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => onDone(false), 10_000);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      {toast && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              className="font-semibold underline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await runUndo(toast.undo!);
                } finally {
                  setBusy(false);
                  onDone(true);
                }
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
